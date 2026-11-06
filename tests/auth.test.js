'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, teardown, createUser, request, PASSWORD, assertTestDatabaseConnection } = require('./helpers');
const User = require('../models/User');

let ctx;
before(async () => { ctx = await setup(); });
after(() => teardown(ctx));

describe('POST /api/auth/register', () => {
  test('creates a passenger, sets an httpOnly cookie, never returns the hash', async () => {
    const res = await request(ctx.app).post('/api/auth/register')
      .send({ name: 'Ada Lovelace', email: 'Ada@Example.com', password: PASSWORD }).expect(201);
    assert.equal(res.body.user.email, 'ada@example.com'); // normalised
    assert.equal(res.body.user.role, 'passenger');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.match(res.headers['set-cookie'][0], /token=.*HttpOnly/i);
    assert.match(res.headers['set-cookie'][0], /SameSite=Lax/i);
  });

  test('cannot self-assign a privileged role (privilege escalation)', async () => {
    const res = await request(ctx.app).post('/api/auth/register')
      .send({ name: 'Mallory', email: 'mallory@example.com', password: PASSWORD, role: 'admin' }).expect(201);
    assert.equal(res.body.user.role, 'passenger');
    assert.equal((await User.findOne({ email: 'mallory@example.com' })).role, 'passenger');
  });

  test('rejects duplicate emails (409), weak passwords and bad emails (400)', async () => {
    await request(ctx.app).post('/api/auth/register').send({ name: 'Ada Again', email: 'ada@example.com', password: PASSWORD }).expect(409);
    await request(ctx.app).post('/api/auth/register').send({ name: 'Weak', email: 'weak@example.com', password: 'short' }).expect(400);
    await request(ctx.app).post('/api/auth/register').send({ name: 'Bad', email: 'not-an-email', password: PASSWORD }).expect(400);
  });

  test('stores a bcrypt hash, not the password', async () => {
    const u = await User.findOne({ email: 'ada@example.com' }).select('+passwordHash');
    assert.match(u.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(u.passwordHash, PASSWORD);
  });
});

describe('POST /api/auth/login', () => {
  test('succeeds with correct credentials and records lastLoginAt', async () => {
    const user = await createUser('passenger');
    const res = await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    assert.equal(res.body.user.email, user.email);
    assert.ok((await User.findById(user._id)).lastLoginAt);
  });

  test('gives the same error for a wrong password and an unknown email', async () => {
    const user = await createUser('passenger');
    const wrong = await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
    const unknown = await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);
    assert.equal(wrong.body.error, unknown.body.error);
  });

  test('blocks deactivated accounts', async () => {
    const user = await createUser('passenger', { active: false });
    await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(403);
  });

  test('does not allow NoSQL operator injection in the email field', async () => {
    await createUser('admin', { email: 'boss@example.com' });
    await request(ctx.app).post('/api/auth/login').send({ email: { $ne: null }, password: PASSWORD }).expect(400);
  });
});

describe('sessions', () => {
  test('/me requires authentication', async () => {
    await request(ctx.app).get('/api/auth/me').expect(401);
  });

  test('accepts the cookie and a Bearer token; logout clears the cookie', async () => {
    const user = await createUser('controller');
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.role, 'controller');
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);

    const token = jwt.sign({ sub: String(user._id) }, ctx.env.JWT_SECRET, { expiresIn: '1h' });
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  });

  test('rejects tampered, expired, unsigned and wrong-secret tokens', async () => {
    const user = await createUser('passenger');
    const bad = [
      jwt.sign({ sub: String(user._id) }, 'a-different-secret-a-different-secret-12', { expiresIn: '1h' }),
      jwt.sign({ sub: String(user._id) }, ctx.env.JWT_SECRET, { expiresIn: -10 }),
      jwt.sign({ sub: String(user._id) }, '', { algorithm: 'none' }),
    ];
    for (const t of bad) await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${t}`).expect(401);
  });

  test('a valid token for a deleted or deactivated user stops working immediately', async () => {
    const user = await createUser('controller');
    const token = jwt.sign({ sub: String(user._id) }, ctx.env.JWT_SECRET, { expiresIn: '1h' });
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    await User.findByIdAndUpdate(user._id, { active: false });
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    assertTestDatabaseConnection();
    await User.findByIdAndDelete(user._id);
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
});
