const mongoose = require('mongoose');

const DisruptionSchema = new mongoose.Schema({
  trainId:   { type: String, required: true },
  line:      { type: String, required: true },
  cause:     { type: String, required: true },
  delay:     { type: Number, required: true },
  severity:  { type: String, enum: ['Critical', 'Moderate', 'Minor'], default: 'Moderate' },
  status:    { type: String, enum: ['Active', 'Resolved'], default: 'Active' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Disruption', DisruptionSchema);