(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow } = window.TT;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let trains = [];
  let chart;

  // ---- live socket events -------------------------------------------------
  const socket = typeof io === 'function' ? io() : null;
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
    for (const ev of ['scheduleUpdated', 'scheduleCreated', 'scheduleDeleted']) socket.on(ev, () => { loadTrains(); loadStats(); });
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

  $('#searchInput').addEventListener('input', debounce(loadTrains));
  $('#statusFilter').addEventListener('change', loadTrains);
  $('#groupBy').addEventListener('change', loadTrend);
  $('#exportBtn').addEventListener('click', () => {
    if (!trains.length) return toast('Nothing to export', true);
    downloadCSV('trains.csv', ['Train ID', 'Line', 'Departure', 'Arrival', 'Delay (min)', 'Status'],
      trains.map((t) => [t.trainId, t.line, t.scheduledDeparture, t.scheduledArrival, t.delay || 0, t.status]));
  });

  initPredictor(); loadStats(); loadAlerts(); loadTrend(); loadTrains();
  setInterval(refreshLive, 30000);
})();
