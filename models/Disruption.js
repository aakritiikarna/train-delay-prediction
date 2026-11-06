'use strict';
const mongoose = require('mongoose');

const DisruptionSchema = new mongoose.Schema(
  {
    trainId: { type: String, required: true, trim: true, maxlength: 20 },
    line: { type: String, required: true, trim: true, maxlength: 40 },
    cause: { type: String, required: true, trim: true, maxlength: 120 },
    delay: { type: Number, required: true, min: 0, max: 1440 },
    severity: { type: String, enum: ['Critical', 'Moderate', 'Minor'], default: 'Moderate' },
    status: { type: String, enum: ['Active', 'Resolved'], default: 'Active' },
    resolvedAt: Date,
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Dashboards list active disruptions newest-first and filter by line.
DisruptionSchema.index({ status: 1, createdAt: -1 });
DisruptionSchema.index({ line: 1, createdAt: -1 });

module.exports = mongoose.model('Disruption', DisruptionSchema);
