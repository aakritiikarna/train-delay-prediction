'use strict';
const mongoose = require('mongoose');

/**
 * One row of the training dataset (data/train_delays.csv). Kept separate from
 * `Disruption` so historical data never pollutes live operational records.
 */
const HistoricalDelaySchema = new mongoose.Schema({
  distanceKm: { type: Number, required: true, min: 0 },
  weather: { type: String, required: true, index: true },
  dayOfWeek: { type: String, required: true },
  timeOfDay: { type: String, required: true },
  trainType: { type: String, required: true, index: true },
  congestion: { type: String, required: true, index: true },
  delayMin: { type: Number, required: true, min: 0 },
});

module.exports = mongoose.model('HistoricalDelay', HistoricalDelaySchema);
