'use strict';
const mongoose = require('mongoose');

const PredictionHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inputs: {
      trainType: { type: String, required: true },
      weather: { type: String, required: true },
      timeOfDay: { type: String, required: true },
      congestion: { type: String, required: true },
      day: { type: String, required: true },
      distance: { type: Number, required: true, min: 0, max: 2000 },
    },
    predictedDelay: { type: Number, required: true, min: 0 },
    modelVersion: { type: String, maxlength: 80 },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true }
);

PredictionHistorySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('PredictionHistory', PredictionHistorySchema);
