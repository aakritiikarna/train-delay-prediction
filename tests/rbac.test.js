'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, loginAs, request } = require('./helpers');
const Disruption = require('../models/Disruption');

let ctx;
const body = { trainId: 'TR-1', line: 'Line A', cause: 'Signal Failure', delay: 12, severity: 'Minor' };
before(async () => { ctx = await setup(); });
after(() => teardown(ctx));

describe('API role-based access control', () => {
  test('reads of disruptions, schedules and stats are public', async () => {
    for (const url of ['/api/disruptions', '/api/schedules', '/api/stats']) await request(ctx.app).get(url).expect(200);
  });

  test('writes need authentication (401), then the right role (403)', async () => {
    await request(ctx.app).post('/api/disruptions').send(body).expect(401);
    const { agent: passenger } = await loginAs(ctx.app, 'passenger');
    await passenger.post('/api/disruptions').send(body).expect(403);
    const { agent: controller } = await loginAs(ctx.app, 'controller');
    await controller.post('/api/disruptions').send(body).expect(201);
  });

  test('controllers can resolve but only admins can delete', async () => {
    const { agent: controller } = await loginAs(ctx.app, 'controller');
    const { agent: admin } = await loginAs(ctx.app, 'admin');
    const { body: d } = await controller.post('/api/disruptions').send(body).expect(201);
    await controller.put(`/api/disruptions/${d._id}/resolve`).expect(200);
    await controller.delete(`/api/disruptions/${d._id}`).expect(403);
    await admin.delete(`/api/disruptions/${d._id}`).expect(200);
    assert.equal(await Disruption.findById(d._id), null);
  });

  test('the entire /api/admin surface is admin-only', async () => {
    const { agent: controller } = await loginAs(ctx.app, 'controller');
    const { agent: passenger } = await loginAs(ctx.app, 'passenger');
    for (const url of ['/api/admin/users', '/api/admin/audit-logs', '/api/admin/messages']) {
      await request(ctx.app).get(url).expect(401);
      await passenger.get(url).expect(403);
      await controller.get(url).expect(403);
    }
    await controller.post('/api/admin/users').send({ name: 'X Y', email: 'x@y.com', password: 'Passw0rd!test' }).expect(403);
  });
});

describe('page access control (enforced server-side)', () => {
  test('anonymous users are redirected from /controller and /admin to /login', async () => {
    const c = await request(ctx.app).get('/controller').expect(302);
    assert.match(c.headers.location, /^\/login\?next=%2Fcontroller/);
    await request(ctx.app).get('/admin').expect(302);
  });

  test('passengers cannot open staff pages; controllers cannot open /admin', async () => {
    const { agent: passenger } = await loginAs(ctx.app, 'passenger');
    await passenger.get('/controller').expect(302);
    await passenger.get('/admin').expect(302);
    const { agent: controller } = await loginAs(ctx.app, 'controller');
    await controller.get('/controller').expect(200);
    await controller.get('/admin').expect(302);
  });

  test('admins can open both; public pages need no login', async () => {
    const { agent: admin } = await loginAs(ctx.app, 'admin');
    await admin.get('/controller').expect(200);
    await admin.get('/admin').expect(200);
    for (const p of ['/', '/login', '/passenger', '/contact']) await request(ctx.app).get(p).expect(200);
  });
});
