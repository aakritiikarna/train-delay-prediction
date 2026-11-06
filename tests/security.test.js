'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, loginAs, request } = require('./helpers');
const ContactMessage = require('../models/ContactMessage');

describe('HTTP hardening', () => {
  let ctx;
  before(async () => { ctx = await setup(); });
  after(() => teardown(ctx));

  test('sends security headers, a strict CSP, and hides x-powered-by', async () => {
    const res = await request(ctx.app).get('/').expect(200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /script-src 'self'/);
    assert.ok(!/unsafe-inline/.test(csp), 'CSP must not allow unsafe-inline');
    assert.match(csp, /frame-ancestors 'none'/);
  });

  test('every shipped page honours the CSP: no inline <script>, handlers or style attributes', async () => {
    const fs = require('node:fs'); const path = require('node:path');
    for (const f of fs.readdirSync(path.join(__dirname, '../views'))) {
      const html = fs.readFileSync(path.join(__dirname, '../views', f), 'utf8');
      assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f}: inline <script>`);
      assert.ok(!/\son\w+\s*=/i.test(html), `${f}: inline event handler`);
      assert.ok(!/\sstyle\s*=/i.test(html), `${f}: inline style attribute`);
      assert.ok(!/<style[\s>]/i.test(html), `${f}: <style> block`);
    }
  });

  test('malformed JSON and oversized bodies get clean 4xx errors', async () => {
    const bad = await request(ctx.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not json').expect(400);
    assert.equal(bad.body.error, 'Malformed JSON body');
    await request(ctx.app).post('/api/contact').send({ name: 'A'.repeat(20000) }).expect(413);
  });

  test('unknown API routes return JSON 404; errors never expose stack traces', async () => {
    const res = await request(ctx.app).get('/api/nope').expect(404);
    assert.deepEqual(res.body, { error: 'Not found' });
    const { agent } = await loginAs(ctx.app, 'admin');
    const r2 = await agent.get('/api/admin/users/../../etc/passwd');
    assert.ok(!JSON.stringify(r2.body).includes('node_modules'));
  });

  test('/health reports database state', async () => {
    const res = await request(ctx.app).get('/health').expect(200);
    assert.equal(res.body.status, 'ok');
  });
});

describe('rate limiting', () => {
  let ctx;
  before(async () => { ctx = await setup({ RATE_LIMIT_ENABLED: 'true' }); });
  after(() => teardown(ctx));

  test('throttles repeated login attempts (brute-force protection)', async () => {
    let last;
    for (let i = 0; i < 25; i++) last = await request(ctx.app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong-pass' });
    assert.equal(last.status, 429);
    assert.match(last.body.error, /too many/i);
  });
});

describe('contact form', () => {
  let ctx;
  before(async () => { ctx = await setup(); });
  after(() => teardown(ctx));

  test('stores valid messages and validates input', async () => {
    await request(ctx.app).post('/api/contact').send({ name: 'Sam', email: 'sam@example.com', message: 'The 08:15 was late again.' }).expect(201);
    assert.equal(await ContactMessage.countDocuments(), 1);
    await request(ctx.app).post('/api/contact').send({ name: 'Sam', email: 'bad', message: 'short' }).expect(400);
  });

  test('only admins can read messages', async () => {
    const { agent: admin } = await loginAs(ctx.app, 'admin');
    const { agent: pax } = await loginAs(ctx.app, 'passenger');
    await pax.get('/api/admin/messages').expect(403);
    const res = await admin.get('/api/admin/messages').expect(200);
    assert.equal(res.body.data[0].email, 'sam@example.com');
  });
});
