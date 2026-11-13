(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow, handleAuthError } = window.TT;
  let disruptions = [], schedules = [], chart, me;
  const fail = (err) => { if (!handleAuthError(err)) toast(err.message, true); };
  const when = (value) => value ? new Date(value).toLocaleString() : '—';

  function addActivity(text, time = new Date()) {
    const feed = $('#activityFeed');
    const item = h('li', {}, h('strong', {}, text), h('span', {}, when(time)));
    feed.prepend(item);
    while (feed.children.length > 10) feed.lastElementChild.remove();
  }

  function refreshOperationalData(message) {
    if (message) addActivity(message);
    loadDisruptions(); loadSchedules(); loadStats(); loadChart(); loadOperations();
    if (message) setTimeout(loadActivity, 750);
    else loadActivity();
  }

  const socket = window.TT.connectSocket();
  if (socket) {
    socket.on('new-disruption', (d) => {
      const notice = `New disruption: ${d.trainId} on ${d.line}, ${d.cause} (${d.delay} min)`;
      $('#liveAlert').textContent = notice;
      $('#liveAlert').hidden = false;
      setTimeout(() => { $('#liveAlert').hidden = true; }, 6000);
      refreshOperationalData(notice);
    });
    socket.on('disruption-resolved', (d) => refreshOperationalData(`Disruption resolved: ${d.trainId} on ${d.line}`));
    socket.on('disruption-deleted', () => refreshOperationalData('A disruption record was deleted.'));
    socket.on('scheduleCreated', (s) => refreshOperationalData(`Schedule created: ${s.trainId} on ${s.line}`));
    socket.on('scheduleUpdated', (s) => refreshOperationalData(`Schedule updated: ${s.trainId} — ${s.status}`));
    socket.on('scheduleDeleted', () => refreshOperationalData('A schedule record was deleted.'));
  }

  async function loadStats() {
    try {
      const s = await api('/api/stats');
      $('#totalTrains').textContent = s.totalTrains;
      $('#activeCount').textContent = s.activeDisruptions;
      $('#resolvedCount').textContent = s.resolvedLast7Days;
      $('#onTimeRate').textContent = s.onTimeRate == null ? '--' : `${s.onTimeRate}%`;
    } catch (err) { fail(err); }
  }

  async function loadOperations() {
    try {
      const overview = await api('/api/operations/overview');
      $('#statusAnalyticsBody').replaceChildren(...(overview.scheduleStatuses.length
        ? overview.scheduleStatuses.map((row) => h('tr', {}, h('td', {}, row.status), h('td', {}, String(row.count))))
        : [emptyRow(2, 'No schedule records yet.')]));
      $('#disruptionAnalyticsBody').replaceChildren(...(overview.disruptionAnalytics.length
        ? overview.disruptionAnalytics.map((row) => h('tr', {}, h('td', {}, `${row.status} / ${row.severity}`), h('td', {}, String(row.count)), h('td', {}, `${row.averageDelay} min`)))
        : [emptyRow(3, 'No disruption records yet.')]));
      $('#routeBody').replaceChildren(...(overview.lines.length
        ? overview.lines.map((line) => h('tr', {}, h('td', {}, line.line), h('td', {}, String(line.trains)), h('td', {}, line.destinations.length ? line.destinations.join(', ') : 'Not recorded')))
        : [emptyRow(3, 'No route data in schedules.')]));

      const lineFilter = $('#filterLine');
      const previousLine = lineFilter.value;
      lineFilter.replaceChildren(h('option', { value: '' }, 'All recorded lines'), ...overview.lines.map((line) => h('option', { value: line.line }, line.line)));
      lineFilter.value = overview.lines.some((line) => line.line === previousLine) ? previousLine : '';
      const scheduleLineFilter = $('#filterScheduleLine');
      const previousScheduleLine = scheduleLineFilter.value;
      scheduleLineFilter.replaceChildren(h('option', { value: '' }, 'All recorded lines'), ...overview.lines.map((line) => h('option', { value: line.line }, line.line)));
      scheduleLineFilter.value = overview.lines.some((line) => line.line === previousScheduleLine) ? previousScheduleLine : '';
    } catch (err) {
      $('#statusAnalyticsBody').replaceChildren(emptyRow(2, 'Unable to load operations overview.'));
      fail(err);
    }
  }

  async function loadActivity() {
    try {
      const { data } = await api('/api/operations/activity?limit=10');
      $('#activityFeed').replaceChildren(...(data.length
        ? data.map((entry) => h('li', {}, h('strong', {}, `${entry.action} — ${entry.details?.trainId || entry.details?.line || entry.entityId || ''}`), h('span', {}, `${entry.actorEmail || 'System'} · ${when(entry.createdAt)}`)))
        : [h('li', { className: 'muted' }, 'No recorded operational activity yet.')]));
    } catch (err) { $('#activityFeed').replaceChildren(h('li', { className: 'muted' }, 'Unable to load operational activity.')); fail(err); }
  }

  async function loadChart() {
    try {
      const { data } = await api('/api/analytics/daily');
      const labels = data.map((d) => new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }));
      const counts = data.map((d) => d.count);
      $('#dailyChart').setAttribute('aria-label', `Disruptions logged per day: ${data.map((d, i) => `${labels[i]} ${counts[i]}`).join(', ')}`);
      if (chart) { chart.data.labels = labels; chart.data.datasets[0].data = counts; chart.update(); return; }
      chart = new Chart($('#dailyChart'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Disruptions logged', data: counts, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.15)', fill: true, tension: 0.3, pointBackgroundColor: '#3b82f6' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: '#334155' } } } },
      });
    } catch (err) { fail(err); }
  }

  async function loadDisruptions() {
    const params = new URLSearchParams({ status: 'Active', limit: '200' });
    if ($('#searchDisrupt').value.trim()) params.set('search', $('#searchDisrupt').value.trim());
    if ($('#filterLine').value) params.set('line', $('#filterLine').value);
    try {
      ({ data: disruptions } = await api(`/api/disruptions?${params}`));
    } catch (err) { $('#disruptBody').replaceChildren(emptyRow(6, 'Unable to load disruptions.')); return fail(err); }
    $('#disruptBody').replaceChildren(...(disruptions.length ? disruptions.map((d) => h('tr', {},
      h('td', {}, d.trainId), h('td', {}, d.line), h('td', {}, d.cause), h('td', {}, `${d.delay} min`),
      h('td', {}, badge(d.severity, d.severity === 'Critical' ? 'badge-red' : d.severity === 'Minor' ? 'badge-blue' : 'badge-yellow')),
      h('td', {}, h('button', { className: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Resolve disruption for ${d.trainId}`, onclick: (e) => resolve(d._id, e.currentTarget) }, 'Resolve')))) : [emptyRow(6, 'No active disruptions')]));
  }

  async function resolve(id, btn) {
    btn.disabled = true; btn.textContent = 'Resolving...';
    try { await api(`/api/disruptions/${id}/resolve`, { method: 'PUT' }); toast('Disruption resolved'); }
    catch (err) { fail(err); }
    refreshOperationalData();
  }

  $('#logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#logMsg'); msg.className = 'form-msg'; msg.textContent = '';
    const trainId = $('#trainId').value.trim(), delay = $('#estDelay').value;
    if (!trainId || delay === '' || !Number.isInteger(Number(delay)) || Number(delay) < 0 || Number(delay) > 1440) {
      msg.className = 'form-msg err'; msg.textContent = 'Enter a train ID and a whole-number delay from 0 to 1440 minutes.'; return;
    }
    try {
      await api('/api/disruptions', { method: 'POST', body: { trainId, line: $('#newLine').value, cause: $('#newCause').value, delay: Number(delay), severity: $('#newSeverity').value } });
      msg.className = 'form-msg ok'; msg.textContent = 'Disruption logged and broadcast to all dashboards.';
      $('#trainId').value = ''; $('#estDelay').value = '';
      refreshOperationalData();
    } catch (err) { if (!handleAuthError(err)) { msg.className = 'form-msg err'; msg.textContent = err.message; } }
  });

  async function loadSchedules() {
    const params = new URLSearchParams({ limit: '200' });
    if ($('#searchSchedule').value.trim()) params.set('search', $('#searchSchedule').value.trim());
    if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
    if ($('#filterScheduleLine').value) params.set('line', $('#filterScheduleLine').value);
    let meta;
    try { ({ data: schedules, meta } = await api(`/api/schedules?${params}`)); }
    catch (err) { $('#scheduleBody').replaceChildren(emptyRow(8, 'Unable to load schedules.')); return fail(err); }
    $('#schedNote').textContent = meta.total > schedules.length ? `Showing ${schedules.length} of ${meta.total}. Use search to narrow down.` : '';
    $('#scheduleBody').replaceChildren(...(schedules.length ? schedules.map((s) => {
      const actions = [h('button', { className: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Edit schedule for ${s.trainId}`, onclick: () => openEdit(s) }, 'Edit')];
      if (me?.role === 'admin') actions.push(h('button', { className: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `Delete schedule for ${s.trainId}`, onclick: () => removeSchedule(s) }, 'Delete'));
      return h('tr', {},
        h('td', {}, s.trainId), h('td', {}, s.scheduledDate || '—'), h('td', {}, s.scheduledTime || s.scheduledDeparture || '—'),
        h('td', {}, s.actualTime || '—'), h('td', {}, s.destination || '—'), h('td', {}, s.driver || '—'),
        h('td', {}, h('label', { className: 'sr-only', for: `status-${s._id}` }, `Status for ${s.trainId}`),
          h('select', { id: `status-${s._id}`, value: s.status || 'On Time', onchange: (e) => updateStatus(s, e.target.value) },
            ...['On Time', 'On Track', 'Departed', 'Delayed', 'Critical', 'Cancelled'].map((status) => h('option', { value: status, selected: status === (s.status || 'On Time') }, status)))),
        h('td', {}, h('div', { className: 'actions' }, ...actions)));
    }) : [emptyRow(8, 'No schedules found')]));
  }

  async function updateStatus(schedule, status) {
    try {
      await api(`/api/schedules/${schedule._id}`, { method: 'PUT', body: { status } });
      toast(`Train status set to ${status}`);
      loadOperations(); loadActivity(); loadStats();
    } catch (err) { fail(err); loadSchedules(); }
  }

  async function removeSchedule(schedule) {
    if (!confirm(`Delete the schedule for ${schedule.trainId}?`)) return;
    try {
      await api(`/api/schedules/${schedule._id}`, { method: 'DELETE' });
      toast('Schedule deleted');
      refreshOperationalData();
    } catch (err) { fail(err); }
  }

  $('#scheduleCreateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    const message = $('#scheduleCreateMsg');
    message.className = 'form-msg'; message.textContent = '';
    const scheduledTime = $('#createDeparture').value;
    const body = {
      trainId: $('#createTrainId').value.trim(),
      line: $('#createLine').value.trim(),
      scheduledDate: $('#createDate').value,
      scheduledTime,
      scheduledDeparture: scheduledTime,
      status: $('#createStatus').value,
    };
    if ($('#createArrival').value) body.scheduledArrival = $('#createArrival').value;
    if ($('#createDestination').value.trim()) body.destination = $('#createDestination').value.trim();
    if ($('#createDriver').value.trim()) body.driver = $('#createDriver').value.trim();
    try {
      await api('/api/schedules', { method: 'POST', body });
      message.className = 'form-msg ok'; message.textContent = 'Schedule created.';
      e.currentTarget.reset();
      refreshOperationalData();
    } catch (err) {
      if (!handleAuthError(err)) { message.className = 'form-msg err'; message.textContent = err.message; }
    }
  });

  const dialog = $('#editDialog');
  function openEdit(s) {
    $('#editId').value = s._id; $('#editTrainId').value = s.trainId;
    $('#editDate').value = s.scheduledDate || '';
    $('#editActualTime').value = s.actualTime || ''; $('#editArrival').value = s.scheduledArrival || '';
    $('#editDelay').value = s.delay ?? 0; $('#editStatus').value = s.status || 'On Time';
    $('#editMsg').textContent = '';
    dialog.showModal();
  }
  $('#editCancel').addEventListener('click', () => dialog.close());
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    const body = { delay: Number($('#editDelay').value), status: $('#editStatus').value };
    if ($('#editDate').value) body.scheduledDate = $('#editDate').value;
    if ($('#editActualTime').value) body.actualTime = $('#editActualTime').value;
    if ($('#editArrival').value) body.scheduledArrival = $('#editArrival').value;
    const btn = $('#editSave'); btn.disabled = true;
    try {
      await api(`/api/schedules/${$('#editId').value}`, { method: 'PUT', body });
      dialog.close(); toast('Schedule updated'); refreshOperationalData();
    } catch (err) { if (!handleAuthError(err)) $('#editMsg').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  $('#exportDisruptions').addEventListener('click', () => disruptions.length
    ? downloadCSV('disruptions.csv', ['Train', 'Line', 'Cause', 'Delay (min)', 'Severity'], disruptions.map((d) => [d.trainId, d.line, d.cause, d.delay, d.severity]))
    : toast('Nothing to export', true));
  $('#exportSchedule').addEventListener('click', () => schedules.length
    ? downloadCSV('dispatch_schedule.csv', ['Train', 'Scheduled date', 'Scheduled', 'Actual', 'Destination', 'Driver', 'Status'], schedules.map((s) => [s.trainId, s.scheduledDate, s.scheduledTime || s.scheduledDeparture, s.actualTime, s.destination, s.driver, s.status]))
    : toast('Nothing to export', true));
  $('#searchDisrupt').addEventListener('input', debounce(loadDisruptions));
  $('#filterLine').addEventListener('change', loadDisruptions);
  $('#searchSchedule').addEventListener('input', debounce(loadSchedules));
  $('#filterStatus').addEventListener('change', loadSchedules);
  $('#filterScheduleLine').addEventListener('change', loadSchedules);

  (window.TT.ready || Promise.resolve()).then(async () => {
    me = await window.TT.requirePageRole(['controller', 'admin']);
    if (!me) return;
    await loadOperations();
    loadStats(); loadChart(); loadDisruptions(); loadSchedules(); loadActivity();
  });
})();
