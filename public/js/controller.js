(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow, handleAuthError } = window.TT;
  let disruptions = [], schedules = [], chart;
  const fail = (err) => { if (!handleAuthError(err)) toast(err.message, true); };

  // ---- real-time -----------------------------------------------------------
  const socket = typeof io === 'function' ? io() : null;
  if (socket) {
    socket.on('new-disruption', (d) => {
      const el = $('#liveAlert');
      el.textContent = `New disruption logged: ${d.trainId} on ${d.line}, ${d.cause} (${d.delay} min)`;
      el.hidden = false; setTimeout(() => { el.hidden = true; }, 6000);
      refreshDisruptions();
    });
    socket.on('disruption-resolved', refreshDisruptions);
    socket.on('disruption-deleted', refreshDisruptions);
    for (const ev of ['scheduleUpdated', 'scheduleCreated', 'scheduleDeleted']) socket.on(ev, () => { loadSchedules(); loadStats(); });
  }

  // ---- stats + chart ----------------------------------------------------------
  async function loadStats() {
    try {
      const s = await api('/api/stats');
      $('#totalTrains').textContent = s.totalTrains;
      $('#activeCount').textContent = s.activeDisruptions;
      $('#resolvedCount').textContent = s.resolvedLast7Days;
      $('#onTimeRate').textContent = s.onTimeRate == null ? '--' : `${s.onTimeRate}%`;
    } catch (err) { fail(err); }
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

  // ---- disruptions ----------------------------------------------------------------
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
  function refreshDisruptions() { loadDisruptions(); loadStats(); loadChart(); }

  async function resolve(id, btn) {
    btn.disabled = true; btn.textContent = 'Resolving...';
    try { await api(`/api/disruptions/${id}/resolve`, { method: 'PUT' }); toast('Disruption resolved'); }
    catch (err) { fail(err); }
    refreshDisruptions();
  }

  $('#logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#logMsg'); msg.className = 'form-msg'; msg.textContent = '';
    const trainId = $('#trainId').value.trim(), delay = $('#estDelay').value;
    if (!trainId || delay === '' || Number(delay) < 0) { msg.className = 'form-msg err'; msg.textContent = 'Enter a train ID and a delay of 0 or more minutes.'; return; }
    try {
      await api('/api/disruptions', { method: 'POST', body: { trainId, line: $('#newLine').value, cause: $('#newCause').value, delay: Number(delay), severity: $('#newSeverity').value } });
      msg.className = 'form-msg ok'; msg.textContent = 'Disruption logged and broadcast to all dashboards.';
      $('#trainId').value = ''; $('#estDelay').value = '';
    } catch (err) { if (!handleAuthError(err)) { msg.className = 'form-msg err'; msg.textContent = err.message; } }
  });

  // ---- schedules -------------------------------------------------------------------------
  async function loadSchedules() {
    const params = new URLSearchParams({ limit: '200' });
    if ($('#searchSchedule').value.trim()) params.set('search', $('#searchSchedule').value.trim());
    if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
    let meta;
    try { ({ data: schedules, meta } = await api(`/api/schedules?${params}`)); }
    catch (err) { $('#scheduleBody').replaceChildren(emptyRow(7, 'Unable to load schedules.')); return fail(err); }
    $('#schedNote').textContent = meta.total > schedules.length ? `Showing ${schedules.length} of ${meta.total}. Use search to narrow down.` : '';
    $('#scheduleBody').replaceChildren(...(schedules.length ? schedules.map((s) => h('tr', {},
      h('td', {}, s.trainId), h('td', {}, s.scheduledTime || '—'), h('td', {}, s.actualTime || '—'),
      h('td', {}, s.destination || '—'), h('td', {}, s.driver || '—'), h('td', {}, badge(s.status || '—')),
      h('td', {}, h('button', { className: 'btn btn-secondary btn-sm', type: 'button', 'aria-label': `Edit schedule for ${s.trainId}`, onclick: () => openEdit(s) }, 'Edit')))) : [emptyRow(7, 'No schedules found')]));
  }

  const dialog = $('#editDialog');
  function openEdit(s) {
    $('#editId').value = s._id; $('#editTrainId').value = s.trainId;
    $('#editActualTime').value = s.actualTime || ''; $('#editArrival').value = s.scheduledArrival || '';
    $('#editDelay').value = s.delay ?? 0; $('#editStatus').value = s.status || 'On Time';
    $('#editMsg').textContent = '';
    dialog.showModal();
  }
  $('#editCancel').addEventListener('click', () => dialog.close());
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { delay: Number($('#editDelay').value) || 0, status: $('#editStatus').value };
    if ($('#editActualTime').value) body.actualTime = $('#editActualTime').value;
    if ($('#editArrival').value) body.scheduledArrival = $('#editArrival').value;
    const btn = $('#editSave'); btn.disabled = true;
    try {
      await api(`/api/schedules/${$('#editId').value}`, { method: 'PUT', body });
      dialog.close(); toast('Schedule updated'); loadSchedules(); loadStats();
    } catch (err) { if (!handleAuthError(err)) $('#editMsg').textContent = err.message; }
    finally { btn.disabled = false; }
  });

  // ---- exports + filters ---------------------------------------------------------------------
  $('#exportDisruptions').addEventListener('click', () => disruptions.length
    ? downloadCSV('disruptions.csv', ['Train', 'Line', 'Cause', 'Delay (min)', 'Severity'], disruptions.map((d) => [d.trainId, d.line, d.cause, d.delay, d.severity]))
    : toast('Nothing to export', true));
  $('#exportSchedule').addEventListener('click', () => schedules.length
    ? downloadCSV('dispatch_schedule.csv', ['Train', 'Scheduled', 'Actual', 'Destination', 'Driver', 'Status'], schedules.map((s) => [s.trainId, s.scheduledTime, s.actualTime, s.destination, s.driver, s.status]))
    : toast('Nothing to export', true));
  $('#searchDisrupt').addEventListener('input', debounce(loadDisruptions));
  $('#filterLine').addEventListener('change', loadDisruptions);
  $('#searchSchedule').addEventListener('input', debounce(loadSchedules));
  $('#filterStatus').addEventListener('change', loadSchedules);

  loadStats(); loadChart(); loadDisruptions(); loadSchedules();
})();
