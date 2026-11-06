'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, startFakeMl, request } = require('./helpers');
const Disruption = require('../models/Disruption');
const Schedule = require('../models/Schedule');
const HistoricalDelay = require('../models/HistoricalDelay');

const input = { trainType: 'Express', weather: 'Rainy', timeOfDay: 'Morning', congestion: 'High', day: 'Monday', distance: 120 };

describe('POST /api/predictions', () => {
  let ctx, ml, mode = 'ok';
  before(async () => {
    ml = await startFakeMl((req, res) => {
      if (mode === 'error') return res.writeHead(500).end('boom');
      if (mode === 'slow') return; // never answers -> client timeout
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ predicted_delay: 42.5, warnings: ['demo'], model_version: 'v-test' }));
    });
    ctx = await setup({ ML_SERVICE_URL: ml.url, ML_TIMEOUT_MS: '300' });
  });
  after(async () => { ml.server.closeAllConnections(); ml.server.close(); await teardown(ctx); });

  test('validates input, forwards snake_case to the model service and returns its answer', async () => {
    const res = await request(ctx.app).post('/api/predictions').send(input).expect(200);
    assert.deepEqual(res.body, { predictedDelay: 42.5, warnings: ['demo'], modelVersion: 'v-test' });
    assert.deepEqual(ml.received.at(-1), { distance: 120, weather: 'Rainy', day: 'Monday', time_of_day: 'Morning', train_type: 'Express', congestion: 'High' });
  });

  test('rejects unknown categories and out-of-range numbers before calling the model', async () => {
    const before = ml.received.length;
    await request(ctx.app).post('/api/predictions').send({ ...input, weather: 'Snow' }).expect(400);
    await request(ctx.app).post('/api/predictions').send({ ...input, distance: -1 }).expect(400);
    await request(ctx.app).post('/api/predictions').send({ ...input, distance: 'abc' }).expect(400);
    await request(ctx.app).post('/api/predictions').send({}).expect(400);
    assert.equal(ml.received.length, before);
  });

  test('returns 502 when the model service errors and 503 when it times out', async () => {
    mode = 'error';
    await request(ctx.app).post('/api/predictions').send(input).expect(502);
    mode = 'slow';
    const res = await request(ctx.app).post('/api/predictions').send(input).expect(503);
    assert.match(res.body.error, /unavailable/i);
    mode = 'ok';
  });
});

describe('prediction service down', () => {
  let ctx;
  before(async () => { ctx = await setup(); }); // default ML url is unreachable
  after(() => teardown(ctx));
  test('503 with a friendly message, never a stack trace', async () => {
    const res = await request(ctx.app).post('/api/predictions').send(input).expect(503);
    assert.ok(!JSON.stringify(res.body).includes('ECONNREFUSED'));
  });
  test('/health?deep=true reports the ML service as down but the app stays up', async () => {
    const res = await request(ctx.app).get('/health?deep=true').expect(200);
    assert.equal(res.body.mlService, 'down');
    assert.equal(res.body.db, 'connected');
  });
});

describe('stats and analytics', () => {
  let ctx;
  before(async () => { ctx = await setup(); });
  after(() => teardown(ctx));

  test('/api/stats on an empty database returns zeros and a null rate (no divide-by-zero)', async () => {
    const { body } = await request(ctx.app).get('/api/stats').expect(200);
    assert.deepEqual(body, { activeDisruptions: 0, avgActiveDelay: 0, totalTrains: 0, onTimeTrains: 0, onTimeRate: null, resolvedLast7Days: 0 });
  });

  test('/api/stats computes counts, average delay and on-time rate', async () => {
    const base = { line: 'Line A', cause: 'x' };
    await Disruption.insertMany([
      { ...base, trainId: 'a', delay: 10 }, { ...base, trainId: 'b', delay: 20 },
      { ...base, trainId: 'c', delay: 5, status: 'Resolved', resolvedAt: new Date() },
    ]);
    await Schedule.insertMany([
      { trainId: 't1', line: 'A', status: 'On Time' }, { trainId: 't2', line: 'A', status: 'Departed' },
      { trainId: 't3', line: 'A', status: 'Delayed', delay: 10 }, { trainId: 't4', line: 'A', status: 'Critical', delay: 30 },
    ]);
    const { body } = await request(ctx.app).get('/api/stats').expect(200);
    assert.equal(body.activeDisruptions, 2);
    assert.equal(body.avgActiveDelay, 15);
    assert.equal(body.totalTrains, 4);
    assert.equal(body.onTimeRate, 50);
    assert.equal(body.resolvedLast7Days, 1);
  });

  test('/api/analytics/daily returns 7 zero-filled UTC days with disruptions on the right day', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    await Disruption.collection.insertOne({ trainId: 'old', line: 'Line A', cause: 'x', delay: 30, status: 'Active', severity: 'Minor', createdAt: twoDaysAgo, updatedAt: twoDaysAgo });
    const { body } = await request(ctx.app).get('/api/analytics/daily').expect(200);
    assert.equal(body.data.length, 7);
    const day = body.data.find((d) => d.date === twoDaysAgo.toISOString().slice(0, 10));
    assert.equal(day.count, 1);
    assert.equal(day.avgDelay, 30);
  });

  test('/api/analytics/historical groups the imported dataset and validates groupBy', async () => {
    await HistoricalDelay.insertMany([
      { distanceKm: 100, weather: 'Clear', dayOfWeek: 'Monday', timeOfDay: 'Morning', trainType: 'Express', congestion: 'Low', delayMin: 10 },
      { distanceKm: 100, weather: 'Clear', dayOfWeek: 'Monday', timeOfDay: 'Morning', trainType: 'Express', congestion: 'Low', delayMin: 20 },
      { distanceKm: 100, weather: 'Rainy', dayOfWeek: 'Monday', timeOfDay: 'Morning', trainType: 'Local', congestion: 'Low', delayMin: 40 },
    ]);
    const w = (await request(ctx.app).get('/api/analytics/historical?groupBy=weather').expect(200)).body;
    assert.deepEqual(w.data, [{ label: 'Clear', avgDelay: 15, count: 2 }, { label: 'Rainy', avgDelay: 40, count: 1 }]);
    await request(ctx.app).get('/api/analytics/historical?groupBy=$where').expect(400);
  });
});
