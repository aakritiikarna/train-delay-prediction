(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow } = window.TT;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let trains = [];
  let chart;
  let mapData = { trains: [], disruptions: [], lines: [] };

  // ---- live socket events -------------------------------------------------
  const socket = window.TT.notificationSocket || window.TT.connectSocket();
  if (socket) window.TT.notificationSocket = socket;
  if (socket) {
    socket.on('new-disruption', (d) => {
      const banner = $('#alertBanner');
      banner.textContent = `New disruption: train ${d.trainId} on ${d.line}, ${d.cause} (${d.delay} min delay)`;
      banner.hidden = false;
      setTimeout(() => { banner.hidden = true; }, 8000);
      refreshLive();
    });
    socket.on('disruption-resolved', refreshLive);
    socket.on('disruption-deleted', refreshLive);
    for (const ev of ['scheduleUpdated', 'scheduleCreated', 'scheduleDeleted']) socket.on(ev, () => { loadTrains(); loadStats(); loadMap(); loadRouteComparison(); loadTrainPerformance(); });
  }

  // ---- stats + alerts ---------------------------------------------------------
  function suggestCongestion(activeCount) {
    const level = activeCount >= 3 ? 'High' : activeCount >= 1 ? 'Medium' : 'Low';
    if ($('#congestion').dataset.touched !== 'yes') {
      $('#congestion').value = level;
      $('#autofillBadge').hidden = activeCount === 0;
    }
  }

  async function loadStats() {
    try {
      const s = await api('/api/stats');
      $('#statDisruptions').textContent = s.activeDisruptions;
      $('#statOnTime').textContent = s.onTimeRate == null ? '--' : `${s.onTimeRate}%`;
      $('#statOnTimeSub').textContent = `${s.onTimeTrains} of ${s.totalTrains} trains`;
      $('#statAvgDelay').textContent = `${s.avgActiveDelay} min`;
      $('#statResolved').textContent = s.resolvedLast7Days;
      suggestCongestion(s.activeDisruptions);
    } catch {
      for (const id of ['statDisruptions', 'statOnTime', 'statAvgDelay', 'statResolved']) $(`#${id}`).textContent = '—';
    }
  }

  async function loadAlerts() {
    const box = $('#alertsList');
    try {
      const { data } = await api('/api/disruptions?status=Active&limit=5');
      if (!data.length) { box.replaceChildren(h('p', { className: 'ok-text' }, '✓ All trains running normally.')); return; }
      box.replaceChildren(...data.map((d) => h('div', { className: `alert-item ${d.severity === 'Critical' ? '' : d.severity === 'Moderate' ? 'warning' : 'info'}` },
        h('strong', {}, `Train ${d.trainId}, ${d.line}`),
        h('span', {}, `${d.cause} | Delay: ${d.delay} min | Severity: ${d.severity}`))));
    } catch {
      box.replaceChildren(h('p', { className: 'muted' }, 'Unable to load alerts.'));
    }
  }
  function refreshLive() { loadAlerts(); loadStats(); }

  // ---- predictor ----------------------------------------------------------------
  function initPredictor() {
    const today = DAYS[new Date().getDay()];
    $('#day').replaceChildren(...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => h('option', { selected: d === today }, d)));
    $('#congestion').addEventListener('change', () => { $('#congestion').dataset.touched = 'yes'; $('#autofillBadge').hidden = true; });

    $('#predictForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = {
        trainType: $('#trainType').value, weather: $('#weather').value, timeOfDay: $('#timeOfDay').value,
        congestion: $('#congestion').value, day: $('#day').value, distance: Number($('#distance').value),
      };
      const box = $('#resultBox'), val = $('#delayVal'), ctx = $('#delayContext'), warn = $('#delayWarn');
      if (!Number.isFinite(input.distance) || input.distance < 1) { $('#distance').setAttribute('aria-invalid', 'true'); $('#distance').focus(); return; }
      $('#distance').removeAttribute('aria-invalid');
      const btn = $('#predictBtn'); btn.disabled = true; btn.textContent = 'Predicting...';
      box.hidden = false; box.classList.remove('error'); val.textContent = '...'; ctx.textContent = ''; warn.textContent = '';
      try {
        const r = await api('/api/predictions', { method: 'POST', body: input });
        val.textContent = `${r.predictedDelay} min`;
        const num = $('#trainNumber').value.trim();
        ctx.textContent = `${num ? `Train ${num} | ` : ''}${input.trainType} | ${input.congestion} congestion | ${input.timeOfDay} | ${input.weather} | ${input.distance} km | ${input.day}`;
        warn.textContent = (r.warnings || []).join(' ');
        $('#predictionInputs').replaceChildren(
          ...[
            `Train type: ${input.trainType}`, `Weather: ${input.weather}`, `Time: ${input.timeOfDay}`,
            `Congestion: ${input.congestion}`, `Day: ${input.day}`, `Distance: ${input.distance} km`,
          ].map((text) => h('span', { className: 'badge' }, text))
        );
      } catch (err) {
        box.classList.add('error');
        val.textContent = err.message;
      } finally { btn.disabled = false; btn.textContent = 'Predict my delay'; }
    });
  }

  // ---- historical chart (real data from the imported dataset) -------------------
  async function loadTrend() {
    const groupBy = $('#groupBy').value;
    try {
      const { data } = await api(`/api/analytics/historical?groupBy=${groupBy}`);
      if (!data.length) { $('#trendNote').textContent = 'No historical data imported yet. Run "npm run import:dataset".'; }
      else $('#trendNote').textContent = 'Average delay in minutes from the training dataset.';
      const labels = data.map((d) => d.label), values = data.map((d) => d.avgDelay);
      $('#trendChart').setAttribute('aria-label', `Average historical delay by ${groupBy}: ${data.map((d) => `${d.label} ${d.avgDelay} minutes`).join(', ')}`);
      if (chart) { chart.data.labels = labels; chart.data.datasets[0].data = values; chart.update(); return; }
      chart = new Chart($('#trendChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Avg delay (min)', data: values, backgroundColor: 'rgba(56,189,248,.6)', borderColor: '#38bdf8', borderWidth: 1, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }, y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } } } },
      });
    } catch { $('#trendNote').textContent = 'Unable to load trend data.'; }
  }

  // ---- upcoming trains -----------------------------------------------------------------
  async function loadTrains() {
    const params = new URLSearchParams({ limit: '200' });
    if ($('#searchInput').value.trim()) params.set('search', $('#searchInput').value.trim());
    if ($('#statusFilter').value) params.set('status', $('#statusFilter').value);
    try {
      const { data, meta } = await api(`/api/schedules?${params}`);
      trains = data;
      $('#trainsNote').textContent = meta.total > data.length ? `Showing ${data.length} of ${meta.total} trains. Use search to narrow down.` : '';
      $('#trainsBody').replaceChildren(...(data.length ? data.map((t) => h('tr', {},
        h('td', {}, t.trainId || '—'), h('td', {}, t.line || '—'), h('td', {}, t.scheduledDeparture || '—'), h('td', {}, t.scheduledArrival || '—'),
        h('td', {}, `${t.delay || 0} min`), h('td', {}, badge(t.status || '—')))) : [emptyRow(6, 'No trains found.')]));
    } catch { $('#trainsBody').replaceChildren(emptyRow(6, 'Unable to load trains.')); }
  }

  function svgNode(tag, attrs = {}, text = '') {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }

  function showMapDetail(title, description) {
    $('#mapDetail').replaceChildren(h('h3', {}, title), h('p', { className: 'muted' }, description));
  }

  function updateMapFilters() {
    const filter = $('#mapRouteFilter');
    const selected = filter.value;
    const lines = [...new Set(mapData.lines)].sort((a, b) => a.localeCompare(b));
    filter.replaceChildren(h('option', { value: '' }, 'All routes'), ...lines.map((line) => h('option', { value: line }, line)));
    if (lines.includes(selected)) filter.value = selected;
  }

  function renderMap() {
    const svg = $('#railwayMap');
    const selectedLine = $('#mapRouteFilter').value;
    const query = $('#mapSearch').value.trim().toLocaleLowerCase();
    const activeDisruptions = mapData.disruptions;
    const visibleLines = mapData.lines.filter((line) => {
      if (selectedLine && line !== selectedLine) return false;
      if (!query) return true;
      return line.toLocaleLowerCase().includes(query)
        || mapData.trains.some((train) => train.line === line && train.trainId.toLocaleLowerCase().includes(query))
        || activeDisruptions.some((item) => item.line === line && `${item.trainId} ${item.cause}`.toLocaleLowerCase().includes(query))
        || 'demo node 1 demo node 2'.includes(query);
    });
    const rowHeight = 76;
    const height = Math.max(250, 76 + visibleLines.length * rowHeight);
    svg.setAttribute('viewBox', `0 0 1000 ${height}`);
    svg.replaceChildren();

    if (!visibleLines.length) {
      svg.append(svgNode('text', { x: 500, y: 120, 'text-anchor': 'middle', class: 'rail-label' }, 'No matching recorded routes'));
      $('#mapStatus').textContent = 'No matching routes';
      return;
    }

    visibleLines.forEach((line, index) => {
      const y = 55 + index * rowHeight;
      const routeTrains = mapData.trains.filter((train) => train.line === line
        && (!query || line.toLocaleLowerCase().includes(query) || train.trainId.toLocaleLowerCase().includes(query)));
      const routeDisruptions = activeDisruptions.filter((item) => item.line === line
        && (!query || line.toLocaleLowerCase().includes(query) || `${item.trainId} ${item.cause}`.toLocaleLowerCase().includes(query)));
      const track = svgNode('line', { x1: 90, y1: y, x2: 910, y2: y, class: 'rail-track rail-track-active', role: 'button', tabindex: 0, 'aria-label': `Focus route ${line}` });
      const focusRoute = () => {
        $('#mapRouteFilter').value = line;
        renderMap();
        showMapDetail(`Route ${line}`, 'Recorded timetable line. The diagram is schematic and does not contain real stations or geographic coordinates.');
      };
      track.addEventListener('click', focusRoute);
      track.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusRoute(); } });
      svg.append(track);
      svg.append(svgNode('text', { x: 90, y: y - 16, class: 'rail-label' }, line));

      for (const [nodeX, nodeNumber] of [[90, 1], [910, 2]]) {
        const node = svgNode('circle', { cx: nodeX, cy: y, r: 10, class: 'rail-station', role: 'button', tabindex: 0, 'aria-label': `Illustrative station node ${nodeNumber} on ${line}` });
        const details = () => showMapDetail(`Illustrative node ${nodeNumber} · ${line}`, 'This is a schematic placeholder, not a real station. Station names, coordinates, and infrastructure data are not available.');
        node.addEventListener('click', details);
        node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); details(); } });
        svg.append(node);
        svg.append(svgNode('text', { x: nodeX, y: y + 26, class: 'rail-sub-label', 'text-anchor': nodeX === 90 ? 'start' : 'end' }, `Demo node ${nodeNumber}`));
      }

      routeTrains.forEach((train, trainIndex) => {
        let hash = 0;
        for (const char of train.trainId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        const progress = ((Date.now() / 90000 + (hash % 1000) / 1000) % 1);
        const cx = 90 + progress * 820;
        const marker = svgNode('circle', { cx, cy: y - 9 - (trainIndex % 3) * 5, r: 8, class: 'rail-train', role: 'button', tabindex: 0, 'aria-label': `Simulated train ${train.trainId}, ${train.status}, ${train.delay} minute delay` });
        const details = () => showMapDetail(`Train ${train.trainId}`, `${train.line} · ${train.status} · ${train.delay} min recorded delay${train.destination ? ` · Destination ${train.destination}` : ''}. Marker position is simulated, not GPS.`);
        marker.addEventListener('click', details);
        marker.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); details(); } });
        svg.append(marker);
      });

      routeDisruptions.forEach((disruption, disruptionIndex) => {
        const marker = svgNode('circle', { cx: 500 + disruptionIndex * 18, cy: y + 12, r: 8, class: 'rail-disruption', role: 'button', tabindex: 0, 'aria-label': `Recorded disruption on ${line}, train ${disruption.trainId}` });
        const details = () => showMapDetail(`Disruption · train ${disruption.trainId}`, `${line} · ${disruption.cause} · ${disruption.delay} min · ${disruption.severity}. This is a recorded report, not a live sensor reading.`);
        marker.addEventListener('click', details);
        marker.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); details(); } });
        svg.append(marker);
      });
    });
    $('#mapStatus').textContent = `${visibleLines.length} recorded route${visibleLines.length === 1 ? '' : 's'} · ${mapData.trains.length} schedules · ${mapData.disruptions.length} active disruptions`;
  }

  async function loadMap() {
    try {
      mapData = await api('/api/map/overview');
      updateMapFilters();
      renderMap();
    } catch (error) {
      $('#mapStatus').textContent = 'Map data unavailable';
      $('#railwayMap').replaceChildren(svgNode('text', { x: 500, y: 120, 'text-anchor': 'middle', class: 'rail-label' }, 'Unable to load recorded route data'));
      showMapDetail('Map unavailable', error.message);
    }
  }

  async function loadRouteComparison() {
    try {
      const { data } = await api('/api/analytics/routes');
      $('#routeCompareBody').replaceChildren(...(data.length ? data.map((route) => h('tr', {},
        h('td', {}, route.line || 'Unspecified'), h('td', {}, route.trainCount),
        h('td', {}, `${route.averageDelay} min`), h('td', {}, route.activeDisruptions))) : [emptyRow(4, 'No route schedule data recorded.')]));
    } catch (error) {
      $('#routeCompareBody').replaceChildren(emptyRow(4, error.message));
    }
  }

  async function loadTrainPerformance() {
    try {
      const { data } = await api('/api/analytics/train-performance');
      $('#trainPerformanceBody').replaceChildren(...(data.length ? data.map((train) => h('tr', {},
        h('td', {}, train.trainId), h('td', {}, train.line || '—'), h('td', {}, `${train.averageDelay} min`),
        h('td', {}, `${train.onTimeRecords}/${train.tripsRecorded}`))) : [emptyRow(4, 'No train performance records available.')]));
    } catch (error) {
      $('#trainPerformanceBody').replaceChildren(emptyRow(4, error.message));
    }
  }

  async function loadModelReport() {
    try {
      const info = await api('/api/analytics/model');
      const metrics = info.metrics || {};
      const metricRows = [
        ['Model version', info.version || 'Unknown'],
        ['Trained at', info.trained_at || 'Unknown'],
        ['Test MAE', Number.isFinite(metrics.mae) ? `${metrics.mae} min` : 'Not reported'],
        ['Test RMSE', Number.isFinite(metrics.rmse) ? `${metrics.rmse} min` : 'Not reported'],
        ['Test R²', Number.isFinite(metrics.r2) ? metrics.r2 : 'Not reported'],
        ['Median-baseline MAE', Number.isFinite(metrics.baseline_median_mae) ? `${metrics.baseline_median_mae} min` : 'Not reported'],
        ['Evaluation rows', Number.isFinite(metrics.test_rows) ? metrics.test_rows : 'Not reported'],
      ];
      const report = h('div', {},
        h('dl', { className: 'details-list' }, ...metricRows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])),
        h('p', { className: 'model-disclaimer' }, info.evaluationDisclaimer || 'Offline evaluation metrics are not operational accuracy. Dataset provenance is unknown.'),
        h('p', { className: 'hint' }, 'No feature importance or confidence interval is displayed because the service does not provide verified values.'));
      $('#modelReport').replaceChildren(report);
    } catch (error) {
      $('#modelReport').replaceChildren(h('p', { className: 'muted' }, `Model metadata unavailable: ${error.message}`));
    }
  }

  async function loadPredictionHistory() {
    try {
      const { data, summary } = await api('/api/analytics/predictions/history?limit=8');
      $('#predictionHistorySummary').textContent = summary.length
        ? summary.map((item) => `${item.modelVersion}: ${item.predictions} saved, ${item.averagePredictedDelay} min average estimate`).join(' · ')
        : 'No saved prediction analysis yet.';
      $('#predictionHistoryBody').replaceChildren(...(data.length ? data.map((record) => h('tr', {},
        h('td', {}, new Date(record.createdAt).toLocaleString()),
        h('td', {}, `${record.inputs.trainType}, ${record.inputs.weather}, ${record.inputs.timeOfDay}, ${record.inputs.congestion}, ${record.inputs.day}, ${record.inputs.distance} km`),
        h('td', {}, `${record.predictedDelay} min`), h('td', {}, record.modelVersion || 'Unknown'))) : [emptyRow(4, 'No saved predictions yet.')]));
    } catch (error) {
      const message = error.status === 401 ? 'Sign in to view your private prediction history.' : `Unable to load prediction history: ${error.message}`;
      $('#predictionHistoryBody').replaceChildren(emptyRow(4, message));
    }
  }

  async function loadPreferences() {
    const user = await window.TT.currentUser();
    if (!user) { $('#notificationPreferences').hidden = true; return; }
    try {
      const { preferences } = await api('/api/notifications/preferences');
      $('#prefInAppDisruptions').checked = preferences.inAppDisruptions;
      $('#prefInAppSchedules').checked = preferences.inAppScheduleUpdates;
      $('#prefEmailDisruptions').checked = preferences.disruptionEmails;
      $('#prefEmailSchedules').checked = preferences.scheduleEmails;
    } catch (error) {
      $('#preferencesMsg').textContent = error.message;
      $('#preferencesMsg').className = 'form-msg err';
    }
  }

  $('#searchInput').addEventListener('input', debounce(loadTrains));
  $('#statusFilter').addEventListener('change', loadTrains);
  $('#groupBy').addEventListener('change', loadTrend);
  $('#mapRouteFilter').addEventListener('change', renderMap);
  $('#mapSearch').addEventListener('input', debounce(renderMap, 150));
  $('#mapRefresh').addEventListener('click', loadMap);
  $('#preferencesForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = $('#preferencesMsg');
    try {
      await api('/api/notifications/preferences', { method: 'PUT', body: {
        inAppDisruptions: $('#prefInAppDisruptions').checked,
        inAppScheduleUpdates: $('#prefInAppSchedules').checked,
        disruptionEmails: $('#prefEmailDisruptions').checked,
        scheduleEmails: $('#prefEmailSchedules').checked,
      } });
      msg.className = 'form-msg ok'; msg.textContent = 'Preferences saved. Security alerts remain enabled.';
    } catch (error) { msg.className = 'form-msg err'; msg.textContent = error.message; }
  });
  $('#changePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const msg = $('#passwordChangeMsg');
    try {
      const result = await api('/api/auth/password/change', { method: 'POST', body: {
        currentPassword: $('#currentPassword').value,
        password: $('#changedPassword').value,
      } });
      msg.className = result.email.status === 'accepted' ? 'form-msg ok' : 'form-msg err';
      msg.textContent = `${result.message} Security email status: ${result.email.status}.`;
      event.target.reset();
      window.TT.notificationSocket?.disconnect();
      setTimeout(() => { location.href = '/login'; }, 1800);
    } catch (error) { msg.className = 'form-msg err'; msg.textContent = error.message; }
  });
  $('#exportBtn').addEventListener('click', () => {
    if (!trains.length) return toast('Nothing to export', true);
    downloadCSV('trains.csv', ['Train ID', 'Line', 'Departure', 'Arrival', 'Delay (min)', 'Status'],
      trains.map((t) => [t.trainId, t.line, t.scheduledDeparture, t.scheduledArrival, t.delay || 0, t.status]));
  });

  initPredictor(); loadStats(); loadAlerts(); loadTrend(); loadTrains(); loadMap();
  loadModelReport(); loadRouteComparison(); loadTrainPerformance(); loadPredictionHistory(); loadPreferences();
  setInterval(refreshLive, 30000);
  setInterval(() => { renderMap(); }, 10000);
})();
