'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { setup, teardown, loginAs, assertTestDatabaseConnection } = require('./helpers');
const Disruption = require('../models/Disruption');
const Schedule = require('../models/Schedule');

let ctx, controller, admin;
const valid = { trainId: 'TR-9', line: 'Line B', cause: 'Track Maintenance', delay: 20, severity: 'Moderate' };

before(async () => {
  ctx = await setup();
  controller = (await loginAs(ctx.app, 'controller')).agent;
  admin = (await loginAs(ctx.app, 'admin')).agent;
});
after(() => teardown(ctx));

describe('disruptions', () => {
  test('rejects invalid payloads with field-level details', async () => {
    const res = await controller.post('/api/disruptions').send({ trainId: '', line: 'A', cause: 'x', delay: -5 }).expect(400);
    assert.equal(res.body.error, 'Validation failed');
    assert.ok(res.body.details.some((d) => d.field === 'delay'));
    await controller.post('/api/disruptions').send({ ...valid, delay: 'abc' }).expect(400);
    await controller.post('/api/disruptions').send({ ...valid, severity: 'Apocalyptic' }).expect(400);
    await controller.post('/api/disruptions').send({ ...valid, delay: 99999 }).expect(400);
  });

  test('creates, lists with pagination meta, filters by status and line', async () => {
    assertTestDatabaseConnection();
    await Disruption.deleteMany({});
    for (let i = 0; i < 5; i++) await controller.post('/api/disruptions').send({ ...valid, trainId: `TR-${i}`, line: i % 2 ? 'Line A' : 'Line B' }).expect(201);
    const page = await controller.get('/api/disruptions?limit=2&page=2').expect(200);
    assert.equal(page.body.data.length, 2);
    assert.deepEqual(page.body.meta, { page: 2, limit: 2, total: 5, pages: 3 });
    assert.equal((await controller.get('/api/disruptions?line=Line A')).body.meta.total, 2);
    assert.equal((await controller.get('/api/disruptions?status=Resolved')).body.meta.total, 0);
    await controller.get('/api/disruptions?limit=100000').expect(400); // capped
  });

  test('search treats input literally (regex metacharacters are escaped)', async () => {
    assertTestDatabaseConnection();
    await Disruption.deleteMany({});
    await Disruption.create({ ...valid, cause: 'Signal Failure' });
    assert.equal((await controller.get('/api/disruptions?search=.*')).body.meta.total, 0);
    assert.equal((await controller.get('/api/disruptions?search=signal')).body.meta.total, 1);
    await controller.get('/api/disruptions?search=' + encodeURIComponent('(a+)+$')).expect(200); // no ReDoS
  });

  test('query-string operator injection cannot widen a filter', async () => {
    assertTestDatabaseConnection();
    await Disruption.deleteMany({});
    await Disruption.create(valid);
    const res = await controller.get('/api/disruptions?line[$ne]=zzz').expect(200);
    assert.equal(res.body.meta.total, 1); // `line[$ne]` is just an unknown key, ignored
    const res2 = await controller.get('/api/disruptions?status[$ne]=Active').expect(200);
    assert.equal(res2.body.meta.total, 1);
  });

  test('resolve sets status and resolvedAt; 404 for missing; 400 for malformed id', async () => {
    const { body: d } = await controller.post('/api/disruptions').send(valid).expect(201);
    const res = await controller.put(`/api/disruptions/${d._id}/resolve`).expect(200);
    assert.equal(res.body.status, 'Resolved');
    assert.ok(res.body.resolvedAt);
    await controller.put('/api/disruptions/64b7f0c2a1b2c3d4e5f60718/resolve').expect(404);
    await controller.put('/api/disruptions/not-an-id/resolve').expect(400);
  });

  test('stores XSS payloads as inert text (output encoding is the frontend job, tested in e2e)', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { body } = await controller.post('/api/disruptions').send({ ...valid, cause: payload }).expect(201);
    assert.equal(body.cause, payload);
  });

  test('pushes real-time events over Socket.io', async () => {
    await new Promise((r) => ctx.server.listen(0, r));
    const client = connect(`http://127.0.0.1:${ctx.server.address().port}`, { transports: ['websocket'] });
    await new Promise((r) => client.on('connect', r));
    const got = new Promise((r) => client.once('new-disruption', r));
    await controller.post('/api/disruptions').send({ ...valid, trainId: 'TR-LIVE' }).expect(201);
    assert.equal((await got).trainId, 'TR-LIVE');
    client.close();
  });
});

describe('schedules', () => {
  const sched = { trainId: 'TR-100', line: 'Line A', scheduledTime: '08:15', scheduledDeparture: '08:15', scheduledArrival: '10:30', destination: 'North', driver: 'Jo', status: 'On Time' };

  test('create + update with validation of time format, status enum and delay range', async () => {
    const { body: s } = await controller.post('/api/schedules').send(sched).expect(201);
    const ok = await controller.put(`/api/schedules/${s._id}`).send({ actualTime: '08:40', delay: 25, status: 'Delayed' }).expect(200);
    assert.equal(ok.body.delay, 25);
    await controller.put(`/api/schedules/${s._id}`).send({ actualTime: '25:99' }).expect(400);
    await controller.put(`/api/schedules/${s._id}`).send({ status: 'Teleported' }).expect(400);
    await controller.put(`/api/schedules/${s._id}`).send({ delay: -1 }).expect(400);
    await controller.put(`/api/schedules/${s._id}`).send({}).expect(400);
  });

  test('update ignores fields outside the whitelist (no mass assignment)', async () => {
    const { body: s } = await controller.post('/api/schedules').send(sched).expect(201);
    await controller.put(`/api/schedules/${s._id}`).send({ delay: 3, _id: '64b7f0c2a1b2c3d4e5f60718', createdAt: '2000-01-01', $set: { driver: 'hax' } }).expect(200);
    const fresh = await Schedule.findById(s._id);
    assert.equal(fresh.delay, 3);
    assert.equal(fresh.driver, 'Jo');
    assert.notEqual(fresh.createdAt.getFullYear(), 2000);
  });

  test('passengers cannot modify; only admin deletes; missing returns 404', async () => {
    const { agent: passenger } = await loginAs(ctx.app, 'passenger');
    const { body: s } = await controller.post('/api/schedules').send(sched).expect(201);
    await passenger.put(`/api/schedules/${s._id}`).send({ delay: 1 }).expect(403);
    await controller.delete(`/api/schedules/${s._id}`).expect(403);
    await admin.delete(`/api/schedules/${s._id}`).expect(200);
    await admin.delete(`/api/schedules/${s._id}`).expect(404);
    await controller.put('/api/schedules/64b7f0c2a1b2c3d4e5f60718').send({ delay: 1 }).expect(404);
  });

  test('requires trainId and line on create', async () => {
    await controller.post('/api/schedules').send({ status: 'On Time' }).expect(400);
  });
});
