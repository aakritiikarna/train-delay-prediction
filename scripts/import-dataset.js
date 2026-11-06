'use strict';
/** Replaces the HistoricalDelay collection with data/train_delays.csv (idempotent; touches only that collection). */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const csv = require('csvtojson');
const HistoricalDelay = require('../models/HistoricalDelay');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be set');
  const rows = await csv().fromFile(path.join(__dirname, '../data/train_delays.csv'));
  const docs = rows.map((r) => ({
    distanceKm: Number(r['Distance Between Stations (km)']), weather: r['Weather Conditions'], dayOfWeek: r['Day of the Week'],
    timeOfDay: r['Time of Day'], trainType: r['Train Type'], congestion: r['Route Congestion'], delayMin: Number(r['Historical Delay (min)']),
  }));
  await mongoose.connect(process.env.MONGO_URI);
  await HistoricalDelay.deleteMany({});
  await HistoricalDelay.insertMany(docs);
  console.log(`Imported ${docs.length} historical records`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
