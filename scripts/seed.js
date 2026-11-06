'use strict';
/**
 * Seeds demo data. Safe by default: upserts, never deletes, never touches production unless forced.
 *   npm run seed                 -> upsert demo trains/disruptions + admin user
 *   npm run seed -- --reset      -> first wipe Disruptions and Schedules (never Users)
 * Required env: MONGO_URI, ADMIN_EMAIL, ADMIN_PASSWORD. Optional: SEED_DEMO_USERS=true + DEMO_PASSWORD.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Disruption = require('../models/Disruption');
const Schedule = require('../models/Schedule');
const User = require('../models/User');

const day = (n) => new Date(Date.now() - n * 86400000);

async function main() {
  const { MONGO_URI, ADMIN_EMAIL, ADMIN_PASSWORD, NODE_ENV } = process.env;
  if (!MONGO_URI || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('MONGO_URI, ADMIN_EMAIL and ADMIN_PASSWORD must be set');
  if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  const reset = process.argv.includes('--reset');
  if (reset && NODE_ENV === 'production' && !process.argv.includes('--force')) throw new Error('Refusing --reset in production without --force');
  await mongoose.connect(MONGO_URI);
  if (reset) { await Disruption.deleteMany({}); await Schedule.deleteMany({}); console.log('Cleared disruptions and schedules'); }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const users = [{ name: 'Admin', email: ADMIN_EMAIL.toLowerCase(), role: 'admin', password: ADMIN_PASSWORD }];
  if (process.env.SEED_DEMO_USERS === 'true' && process.env.DEMO_PASSWORD) {
    users.push({ name: 'Demo Controller', email: 'controller@traintrack.test', role: 'controller', password: process.env.DEMO_PASSWORD },
      { name: 'Demo Passenger', email: 'passenger@traintrack.test', role: 'passenger', password: process.env.DEMO_PASSWORD });
  }
  for (const { password, ...u } of users) {
    await User.updateOne({ email: u.email }, { $setOnInsert: { ...u, passwordHash: await bcrypt.hash(password, rounds) } }, { upsert: true });
  }

  const schedules = [
    ['TR-101', 'Line A', '08:15', '08:15', '10:30', 0, 'North Station', 'James K.', 'On Time'],
    ['TR-202', 'Line B', '08:30', '08:40', '11:00', 10, 'East Terminal', 'Sara M.', 'Delayed'],
    ['TR-303', 'Line C', '08:45', '09:10', '12:15', 25, 'Airport', 'David L.', 'Delayed'],
    ['TR-404', 'Line D', '09:00', '09:00', '11:30', 0, 'West End', 'Nina P.', 'On Time'],
  ];
  for (const [trainId, line, sched, actual, arr, delay, destination, driver, status] of schedules) {
    await Schedule.updateOne({ trainId }, { $setOnInsert: { trainId, line, scheduledTime: sched, scheduledDeparture: sched, actualTime: actual, scheduledArrival: arr, delay, destination, driver, status } }, { upsert: true });
  }
  // Native collection calls so createdAt can be back-dated for the 7-day chart.
  const disruptions = [
    ['TR-303', 'Line C', 'Signal Failure', 25, 'Critical', 'Active', 0], ['TR-202', 'Line B', 'Track Maintenance', 10, 'Moderate', 'Active', 0],
    ['TR-505', 'Line C', 'Passenger Incident', 12, 'Moderate', 'Resolved', 1], ['TR-101', 'Line A', 'Weather', 18, 'Moderate', 'Resolved', 2],
    ['TR-404', 'Line D', 'Technical Fault', 7, 'Minor', 'Resolved', 3], ['TR-202', 'Line B', 'Signal Failure', 30, 'Critical', 'Resolved', 5],
  ];
  for (const [trainId, line, cause, delay, severity, status, ago] of disruptions) {
    await Disruption.collection.updateOne({ trainId, cause }, { $setOnInsert: { trainId, line, cause, delay, severity, status, createdAt: day(ago), updatedAt: day(ago), ...(status === 'Resolved' ? { resolvedAt: day(ago) } : {}) } }, { upsert: true });
  }
  console.log(`Seeded ${users.length} user(s), ${schedules.length} schedules, ${disruptions.length} disruptions`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
