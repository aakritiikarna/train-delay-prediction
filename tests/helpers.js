'use strict';
const http = require('node:http');
const mongoose = require('mongoose');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { loadEnv } = require('../config/env');
const { createLogger } = require('../config/logger');
const createApp = require('../app');
const User = require('../models/User');

const ISOLATED_TEST_DATABASE = 'traintrack_isolated_test';
const TEST_URI = validateTestUri(process.env.MONGO_URI_TEST || `mongodb://127.0.0.1:27017/${ISOLATED_TEST_DATABASE}`);
const PASSWORD = 'Passw0rd!test';

function validateTestUri(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`MONGO_URI_TEST must be a MongoDB URI for "${ISOLATED_TEST_DATABASE}".`);
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`MONGO_URI_TEST must be a MongoDB URI for "${ISOLATED_TEST_DATABASE}".`);
  }

  const databaseOverrides = [...parsed.searchParams]
    .filter(([key]) => key.toLowerCase() === 'dbname')
    .map(([, value]) => value);
  const authSources = [...parsed.searchParams]
    .filter(([key]) => key.toLowerCase() === 'authsource')
    .map(([, value]) => value.toLowerCase());
  const hasUnsafeAuthSource = authSources.some((name) => !['admin', ISOLATED_TEST_DATABASE].includes(name));

  if (
    parsed.protocol !== 'mongodb:'
    || databaseName !== ISOLATED_TEST_DATABASE
    || databaseOverrides.some((name) => name !== ISOLATED_TEST_DATABASE)
    || hasUnsafeAuthSource
    || parsed.hash
  ) {
    throw new Error(
      `MONGO_URI_TEST must target "${ISOLATED_TEST_DATABASE}" and use a verified authSource (admin or "${ISOLATED_TEST_DATABASE}").`,
    );
  }
  return uri;
}

function assertTestDatabaseConnection() {
  if (mongoose.connection.readyState !== 1
      || mongoose.connection.db?.databaseName !== ISOLATED_TEST_DATABASE) {
    throw new Error(`Refusing database operation: the active MongoDB connection is not "${ISOLATED_TEST_DATABASE}".`);
  }
}

function testEnv(overrides = {}) {
  if (Object.hasOwn(overrides, 'MONGO_URI') || Object.hasOwn(overrides, 'MONGO_URI_TEST')) {
    throw new Error('MongoDB test URIs must be configured with MONGO_URI_TEST before starting the test process.');
  }
  return loadEnv({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    BCRYPT_ROUNDS: '4', // fast hashing in tests only
    RATE_LIMIT_ENABLED: 'false',
    ML_SERVICE_URL: 'http://127.0.0.1:1', // unreachable unless a test overrides it
    ML_TIMEOUT_MS: '1500',
    ...overrides,
    MONGO_URI: TEST_URI,
  });
}

/** Connects only to the isolated test database, clearing it before building the app. */
async function setup(overrides) {
  if (mongoose.connection.readyState !== 0) {
    throw new Error('Refusing to run Node integration tests while a Mongoose connection is already open.');
  }

  const env = testEnv(overrides);
  await mongoose.connect(TEST_URI);
  try {
    assertTestDatabaseConnection();
    await mongoose.connection.dropDatabase();
    assertTestDatabaseConnection();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    const built = createApp(env, createLogger(env));
    return { env, ...built };
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}

async function teardown(ctx) {
  try {
    if (ctx) {
      ctx.io?.close();
      if (ctx.server?.listening) await new Promise((resolve, reject) => {
        ctx.server.close((error) => error ? reject(error) : resolve());
      });
      assertTestDatabaseConnection();
      await mongoose.connection.dropDatabase();
    }
  } finally {
    await mongoose.disconnect();
  }
}

async function createUser(role = 'passenger', overrides = {}) {
  const email = overrides.email || `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  return User.create({
    name: `Test ${role}`,
    email,
    role,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...overrides,
  });
}

/** A supertest agent (keeps cookies) already logged in as a new user with the given role. */
async function loginAs(app, role, overrides) {
  const user = await createUser(role, overrides);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
  return { agent, user };
}

/** Tiny stand-in for the Flask service. `handler(req, res)` decides the response. */
function startFakeMl(handler) {
  return new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/health') { res.writeHead(200).end('{"status":"ok"}'); return; }
        received.push(JSON.parse(body || '{}'));
        handler(req, res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

module.exports = {
  setup, teardown, createUser, loginAs, startFakeMl, request, PASSWORD, TEST_URI, assertTestDatabaseConnection,
};
