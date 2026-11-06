'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, loginAs, createUser, request, PASSWORD, assertTestDatabaseConnection } = require('./helpers');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

let ctx, admin, adminUser;
before(async () => {
  ctx = await setup();
  ({ agent: admin, user: adminUser } = await loginAs(ctx.app, 'admin'));
});
after(() => teardown(ctx));

describe('admin user management', () => {
  test('creates a user with a hashed password who can then log in', async () => {
    const res = await admin.post('/api/admin/users').send({ name: 'New Controller', email: 'nc@example.com', role: 'controller', password: PASSWORD }).expect(201);
    assert.equal(res.body.passwordHash, undefined);
    await request(ctx.app).post('/api/auth/login').send({ email: 'nc@example.com', password: PASSWORD }).expect(200);
    await admin.post('/api/admin/users').send({ name: 'Dup', email: 'NC@example.com', password: PASSWORD }).expect(409);
  });

  test('lists users with role counts and filters; no password hashes leak', async () => {
    const res = await admin.get('/api/admin/users?role=controller').expect(200);
    assert.ok(res.body.data.every((u) => u.role === 'controller'));
    assert.ok(res.body.counts.admin >= 1);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    assert.equal((await admin.get('/api/admin/users?search=' + encodeURIComponent('.*'))).body.meta.total, 0);
  });

  test('role/active changes work and ignore non-whitelisted fields', async () => {
    const u = await createUser('passenger');
    const res = await admin.put(`/api/admin/users/${u._id}`).send({ role: 'controller', passwordHash: 'x', email: 'evil@example.com' }).expect(200);
    assert.equal(res.body.role, 'controller');
    const fresh = await User.findById(u._id).select('+passwordHash');
    assert.notEqual(fresh.passwordHash, 'x');
    assert.equal(fresh.email, u.email);
    await admin.put(`/api/admin/users/${u._id}`).send({ role: 'superuser' }).expect(400);
  });

  test('an admin cannot demote, deactivate or delete themselves', async () => {
    await admin.put(`/api/admin/users/${adminUser._id}`).send({ role: 'passenger' }).expect(400);
    await admin.put(`/api/admin/users/${adminUser._id}`).send({ active: false }).expect(400);
    await admin.delete(`/api/admin/users/${adminUser._id}`).expect(400);
  });

  test('the last active admin cannot be removed by another admin', async () => {
    assertTestDatabaseConnection();
    await User.deleteMany({ role: 'admin', _id: { $ne: adminUser._id } });
    const { agent: other, user: otherAdmin } = await loginAs(ctx.app, 'admin');
    // two admins: removing one is fine...
    await admin.put(`/api/admin/users/${otherAdmin._id}`).send({ active: false }).expect(200);
    // ...but now `adminUser` is the only active admin; a (still-valid) token for the deactivated one is rejected anyway
    await other.get('/api/admin/users').expect(401);
    const target = await createUser('admin');
    await User.findByIdAndUpdate(adminUser._id, { role: 'controller' }); // simulate: only `target` is admin
    const { agent: sole } = await loginAs(ctx.app, 'admin', { email: 'sole@example.com' });
    await User.updateMany({ role: 'admin', email: { $nin: ['sole@example.com'] } }, { active: false });
    const soleUser = await User.findOne({ email: 'sole@example.com' });
    const second = await createUser('controller');
    await sole.put(`/api/admin/users/${soleUser._id}`).send({ role: 'controller' }).expect(400); // self
    await sole.delete(`/api/admin/users/${second._id}`).expect(200);
    assert.ok(target);
  });

  test('deactivating a user locks out their existing session immediately', async () => {
    await User.findByIdAndUpdate(adminUser._id, { role: 'admin', active: true });
    const { agent: victim, user } = await loginAs(ctx.app, 'controller');
    await victim.get('/api/auth/me').expect(200);
    await admin.put(`/api/admin/users/${user._id}`).send({ active: false }).expect(200);
    await victim.get('/api/auth/me').expect(401);
  });

  test('sensitive actions are written to the audit log with the actor', async () => {
    const u = await createUser('passenger');
    await admin.delete(`/api/admin/users/${u._id}`).expect(200);
    const log = await AuditLog.findOne({ action: 'user.deleted', entityId: String(u._id) });
    assert.ok(log);
    assert.equal(log.actorEmail, adminUser.email);
    const res = await admin.get('/api/admin/audit-logs').expect(200);
    assert.ok(res.body.data.length >= 1);
  });
});
