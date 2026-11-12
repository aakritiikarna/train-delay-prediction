'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, loginAs, request, assertTestDatabaseConnection } = require('./helpers');
const Schedule = require('../models/Schedule');
const Disruption = require('../models/Disruption');
const AuditLog = require('../models/AuditLog');
const ContactMessage = require('../models/ContactMessage');
const SecurityEvent = require('../models/SecurityEvent');

let ctx, controller, admin, passenger, adminUser;
before(async () => {
  ctx = await setup();
  ({ agent: controller } = await loginAs(ctx.app, 'controller'));
  ({ agent: admin, user: adminUser } = await loginAs(ctx.app, 'admin'));
  ({ agent: passenger } = await loginAs(ctx.app, 'passenger'));
});
after(() => teardown(ctx));

describe('controller operations', () => {
  test('operations overview is staff-only and reflects only database schedule/disruption records', async () => {
    assertTestDatabaseConnection();
    await Schedule.deleteMany({});
    await Disruption.deleteMany({});
    await AuditLog.deleteMany({});
    await request(ctx.app).get('/api/operations/overview').expect(401);
    await passenger.get('/api/operations/overview').expect(403);

    const { body: schedule } = await controller.post('/api/schedules').send({
      trainId: 'OPS-1', line: 'Recorded Line', scheduledDate: '2026-11-12',
      scheduledTime: '08:05', scheduledDeparture: '08:05', destination: 'Recorded Destination', status: 'Delayed',
    }).expect(201);
    await controller.post('/api/disruptions').send({
      trainId: 'OPS-1', line: 'Recorded Line', cause: 'Signal issue', delay: 12, severity: 'Minor',
    }).expect(201);

    const { body } = await controller.get('/api/operations/overview').expect(200);
    assert.equal(body.totalSchedules, 1);
    assert.equal(body.activeDisruptions, 1);
    assert.deepEqual(body.lines[0], { line: 'Recorded Line', trains: 1, destinations: ['Recorded Destination'] });
    assert.deepEqual(body.recordedDestinations, ['Recorded Destination']);
    assert.ok(body.scheduleStatuses.some((row) => row.status === 'Delayed' && row.count === 1));
    assert.ok(body.disruptionAnalytics.some((row) => row.status === 'Active' && row.severity === 'Minor'));
    await controller.put(`/api/schedules/${schedule._id}`).send({ status: 'Departed' }).expect(200);
    const activity = await controller.get('/api/operations/activity?limit=10').expect(200);
    assert.ok(activity.body.data.some((row) => row.action === 'schedule.updated'));
  });

  test('schedule dates reject impossible calendar dates and invalid times', async () => {
    const invalidDate = await controller.post('/api/schedules').send({
      trainId: 'OPS-BAD', line: 'Recorded Line', scheduledDate: '2026-02-30', scheduledTime: '10:00',
    }).expect(400);
    assert.equal(invalidDate.body.error, 'Validation failed');
    await controller.post('/api/schedules').send({
      trainId: 'OPS-BAD', line: 'Recorded Line', scheduledDate: '2026-11-12', scheduledTime: '25:00',
    }).expect(400);
    await controller.post('/api/schedules').send({
      trainId: 'OPS-LEGACY', line: 'Recorded Line',
    }).expect(201);
    assert.equal(await Schedule.countDocuments({ trainId: 'OPS-LEGACY' }), 1);
  });
});

describe('admin system management', () => {
  test('system overview and health are admin-only and health reports service status without secrets', async () => {
    await request(ctx.app).get('/api/admin/system-health').expect(401);
    await controller.get('/api/admin/overview').expect(403);
    await controller.get('/api/admin/system-health').expect(403);

    const overview = await admin.get('/api/admin/overview').expect(200);
    assert.ok(overview.body.totalUsers >= 3);
    assert.ok(overview.body.roleCounts.admin >= 1);
    const { body } = await admin.get('/api/admin/system-health').expect(200);
    assert.equal(body.nodeApi.status, 'available');
    assert.equal(body.mongodb.status, 'connected');
    assert.equal(body.smtp.status, 'not_configured');
    assert.ok(!JSON.stringify(body).includes(ctx.env.JWT_SECRET));
    assert.equal(body.jwt, undefined);
  });

  test('failed sign-ins are monitored without recording or exposing credentials', async () => {
    await SecurityEvent.deleteMany({});
    await request(ctx.app).post('/api/auth/login').send({ email: adminUser.email, password: 'wrong-password' }).expect(401);
    const events = await admin.get('/api/admin/security-events?search=invalid_credentials').expect(200);
    assert.equal(events.body.meta.total, 1);
    assert.equal(events.body.data[0].email, adminUser.email);
    assert.equal(events.body.data[0].reason, 'invalid_credentials');
    assert.equal(events.body.data[0].password, undefined);
    const overview = await admin.get('/api/admin/overview').expect(200);
    assert.equal(overview.body.failedLoginsLast7Days, 1);
    const detail = await admin.get(`/api/admin/users/${adminUser._id}`).expect(200);
    assert.equal(detail.body.user.emailVerified, false);
    assert.equal(detail.body.user.passwordHash, undefined);
    assert.ok(!JSON.stringify(detail.body).includes('passwordHash'));
    await passenger.get('/api/admin/security-events').expect(403);
  });

  test('contact read state, audit filters, and audit trail are admin-managed', async () => {
    const message = await ContactMessage.create({ name: 'Reporter', email: 'reporter@example.com', message: 'A message that needs review.' });
    await controller.put(`/api/admin/messages/${message._id}/read`).send({ read: true }).expect(403);
    const unread = await admin.get('/api/admin/messages?read=false').expect(200);
    assert.ok(unread.body.data.some((row) => String(row._id) === String(message._id)));

    await admin.put(`/api/admin/messages/${message._id}/read`).send({ read: true }).expect(200);
    const read = await admin.get('/api/admin/messages?read=true').expect(200);
    assert.ok(read.body.data.some((row) => String(row._id) === String(message._id) && row.read));
    const today = new Date().toISOString().slice(0, 10);
    const logs = await admin.get(`/api/admin/audit-logs?action=contact_message.read_status_changed&from=${today}&to=${today}`).expect(200);
    assert.ok(logs.body.data.some((row) => row.entityId === String(message._id)));
    await admin.get('/api/admin/audit-logs?from=2026-02-30').expect(400);
  });

  test('user search and pagination keep user records free of hashes and tokens', async () => {
    const { body } = await admin.get('/api/admin/users?page=1&limit=2').expect(200);
    assert.equal(body.data.length, 2);
    assert.equal(body.meta.limit, 2);
    assert.ok(!JSON.stringify(body).includes('passwordHash'));
    assert.ok(!JSON.stringify(body).includes('token'));
    const found = await admin.get(`/api/admin/users?search=${encodeURIComponent(adminUser.email)}`).expect(200);
    assert.equal(found.body.meta.total, 1);
    assert.equal(found.body.data[0].emailVerified, false);
  });
});
