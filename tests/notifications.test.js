'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { io: connect } = require('socket.io-client');
const { setup, teardown, loginAs, request } = require('./helpers');
const Notification = require('../models/Notification');
const AuthToken = require('../models/AuthToken');
const User = require('../models/User');

let ctx;
let owner, other, admin;
let provider;
let providerMode = 'accepted';
let providerRequests = [];

before(async () => {
  provider = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      providerRequests.push({ headers: req.headers, body: JSON.parse(body || '{}') });
      res.writeHead(providerMode === 'accepted' ? 202 : 503, { 'Content-Type': 'application/json' }).end('{}');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  ctx = await setup({
    EMAIL_API_URL: `http://127.0.0.1:${provider.address().port}/emails`,
    EMAIL_API_KEY: 'test-provider-key',
    EMAIL_FROM: 'TrainTrack AI <alerts@example.com>',
  });
  owner = await loginAs(ctx.app, 'passenger');
  other = await loginAs(ctx.app, 'passenger');
  admin = await loginAs(ctx.app, 'admin');
  await new Promise((resolve) => ctx.server.listen(0, resolve));
});

after(async () => {
  await teardown(ctx);
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
});

describe('notification ownership and state', () => {
  test('private list, unread count, mark-read and mark-all enforce user ownership', async () => {
    await Notification.deleteMany({});
    const ownFirst = await ctx.app.get('notifications').create(owner.user, {
      type: 'security', title: 'Private one', message: 'For owner', dedupeKey: 'ownership:first',
    });
    const ownSecond = await ctx.app.get('notifications').create(owner.user, {
      type: 'security', title: 'Private two', message: 'For owner', dedupeKey: 'ownership:second',
    });
    await ctx.app.get('notifications').create(other.user, {
      type: 'security', title: 'Other user', message: 'Private', dedupeKey: 'ownership:other',
    });

    const ownList = await owner.agent.get('/api/notifications').expect(200);
    assert.equal(ownList.body.data.length, 2);
    assert.equal(ownList.body.unreadCount, 2);
    assert.equal((await other.agent.get('/api/notifications').expect(200)).body.data.length, 1);
    await other.agent.put(`/api/notifications/${ownFirst._id}/read`).expect(404);
    await owner.agent.put(`/api/notifications/${ownFirst._id}/read`).expect(200);
    assert.equal((await owner.agent.get('/api/notifications/unread-count').expect(200)).body.count, 1);
    const readAll = await owner.agent.put('/api/notifications/read-all').expect(200);
    assert.equal(readAll.body.updated, 1);
    assert.equal((await owner.agent.get('/api/notifications/unread-count').expect(200)).body.count, 0);

    const duplicate = await ctx.app.get('notifications').create(owner.user, {
      type: 'security', title: 'Private one', message: 'For owner', dedupeKey: 'ownership:first',
    });
    assert.equal(duplicate, null);
    assert.equal(await Notification.countDocuments({ user: owner.user._id, dedupeKey: 'ownership:first' }), 1);
    assert.equal(String(ownSecond.user), String(owner.user._id));
  });

  test('preferences can disable optional alerts, not mandatory security notifications', async () => {
    const saved = await owner.agent.put('/api/notifications/preferences')
      .send({ inAppDisruptions: false, disruptionEmails: true }).expect(200);
    assert.equal(saved.body.preferences.inAppDisruptions, false);
    assert.equal(saved.body.preferences.disruptionEmails, true);
    await owner.agent.put('/api/notifications/preferences').send({ securityAlerts: false }).expect(400);
    await request(ctx.app).get('/api/notifications').set('Authorization', 'Bearer invalid-token').expect(401);
  });

  test('only admins can access the notification overview', async () => {
    await owner.agent.get('/api/admin/notifications/overview').expect(403);
    const { body } = await admin.agent.get('/api/admin/notifications/overview').expect(200);
    assert.ok(Number.isInteger(body.total));
    assert.ok(body.emailStatuses);
  });
});

describe('notification email delivery', () => {
  test('respects optional-email preferences, reports provider errors, and never claims delivery', async () => {
    await Notification.deleteMany({});
    await owner.user.updateOne({ $set: { 'preferences.inAppDisruptions': true, 'preferences.disruptionEmails': true } });
    providerRequests = [];
    providerMode = 'failed';
    const service = ctx.app.get('notifications');
    const event = {
      preference: 'inAppDisruptions',
      emailPreference: 'disruptionEmails',
      type: 'disruption',
      title: 'Service disruption',
      message: 'Recorded event',
      href: '/passenger',
      emailTemplate: 'disruption-alert',
    };
    const failed = await service.notifyUsersWithPreference(event, 'email:failure:test');
    assert.equal(failed.emailFailures, 1);
    const failureRecord = await Notification.findOne({ user: owner.user._id, dedupeKey: 'email:failure:test' });
    assert.equal(failureRecord.emailStatus, 'failed');
    assert.equal(providerRequests.length, 1);

    providerMode = 'accepted';
    const accepted = await service.notifyUsersWithPreference(event, 'email:accepted:test');
    assert.equal(accepted.emailFailures, 0);
    const acceptedRecord = await Notification.findOne({ user: owner.user._id, dedupeKey: 'email:accepted:test' });
    assert.equal(acceptedRecord.emailStatus, 'accepted');
    assert.equal(providerRequests.length, 2);
    assert.ok(providerRequests[1].headers['idempotency-key']);
    assert.match(providerRequests[1].body.text, /Recorded event/);
    assert.doesNotMatch(providerRequests[1].body.html, /<script/i);
  });

  test('mandatory security notices persist and send independently of optional-email preferences', async () => {
    await owner.user.updateOne({ $set: {
      'preferences.inAppDisruptions': false,
      'preferences.inAppScheduleUpdates': false,
      'preferences.disruptionEmails': false,
      'preferences.scheduleEmails': false,
    } });
    const result = await ctx.app.get('notifications').notifySecurity(owner.user, {
      title: 'Password changed',
      message: 'Security event recorded.',
      dedupeKey: 'security:test',
    });
    assert.equal(result.emailStatus, 'accepted');
    assert.ok(await Notification.findOne({ user: owner.user._id, dedupeKey: 'security:test' }));
  });
});

test('Socket.IO private and admin targeting use authenticated server-assigned rooms', async () => {
  const baseUrl = `http://127.0.0.1:${ctx.server.address().port}`;
  const login = async (email) => {
    const response = await request(ctx.app).post('/api/auth/login').send({ email, password: require('./helpers').PASSWORD }).expect(200);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    const socket = connect(baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  };
  const ownerSocket = await login(owner.user.email);
  const otherSocket = await login(other.user.email);
  const adminSocket = await login(admin.user.email);
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    let ownerEvents = 0, otherEvents = 0, adminEvents = 0;
    ownerSocket.on('notification:new', () => { ownerEvents += 1; });
    otherSocket.on('notification:new', () => { otherEvents += 1; });
    adminSocket.on('admin:notification-count', () => { adminEvents += 1; });
    await ctx.app.get('notifications').create(owner.user, {
      type: 'security', title: 'Socket test', message: 'Private to owner', dedupeKey: 'socket:private',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(ownerEvents, 1);
    assert.equal(otherEvents, 0);
    assert.equal(adminEvents, 1);
  } finally {
    ownerSocket.close();
    otherSocket.close();
    adminSocket.close();
  }
});

test('verification and reset links are hashed, one-time, and invalidate old sessions after reset', async () => {
  const account = request.agent(ctx.app);
  const registration = await account.post('/api/auth/register')
    .send({ name: 'Mail Test', email: 'mail-test@example.com', password: 'StrongPass123!' }).expect(201);
  assert.equal(registration.body.email.status, 'accepted');
  const verificationUrl = providerRequests.at(-1).body.text.match(/https?:\/\/\S+/)[0];
  const verificationToken = new URL(verificationUrl).searchParams.get('verifyToken');
  const verificationRecord = await AuthToken.findOne({ purpose: 'email_verification' });
  assert.notEqual(verificationRecord.tokenHash, verificationToken);
  await account.post('/api/auth/verify-email').send({ token: verificationToken }).expect(200);
  assert.equal((await User.findOne({ email: 'mail-test@example.com' })).emailVerified, true);
  await account.post('/api/auth/verify-email').send({ token: verificationToken }).expect(400);

  await account.get('/api/auth/me').expect(200);
  const reset = await request(ctx.app).post('/api/auth/password-reset/request')
    .send({ email: 'mail-test@example.com' }).expect(202);
  assert.match(reset.body.message, /if the account exists/i);
  const resetUrl = providerRequests.at(-1).body.text.match(/https?:\/\/\S+/)[0];
  const resetToken = new URL(resetUrl).searchParams.get('resetToken');
  const resetRecord = await AuthToken.findOne({ purpose: 'password_reset' });
  assert.notEqual(resetRecord.tokenHash, resetToken);
  const completion = await request(ctx.app).post('/api/auth/password-reset/complete')
    .send({ token: resetToken, password: 'NewStrongPass123!' }).expect(200);
  assert.equal(completion.body.email.status, 'accepted');
  assert.equal((await AuthToken.findById(resetRecord._id)).usedAt instanceof Date, true);
  await account.get('/api/auth/me').expect(401);
  await request(ctx.app).post('/api/auth/login')
    .send({ email: 'mail-test@example.com', password: 'NewStrongPass123!' }).expect(200);
  assert.ok(providerRequests.at(-1).body.text.includes('password was changed'));
  assert.doesNotMatch(providerRequests.at(-1).body.text, /NewStrongPass123!/);
});

test('password change explicitly reports failed mandatory security email', async () => {
  providerMode = 'failed';
  const response = await owner.agent.post('/api/auth/password/change')
    .send({ currentPassword: require('./helpers').PASSWORD, password: 'DifferentPass123!' }).expect(200);
  assert.equal(response.body.email.status, 'failed');
  assert.ok(await Notification.findOne({ user: owner.user._id, type: 'security', title: 'Password changed', emailStatus: 'failed' }));
  await owner.agent.get('/api/auth/me').expect(401);
  assert.doesNotMatch(JSON.stringify(providerRequests.at(-1).body), /DifferentPass123!/);
});
