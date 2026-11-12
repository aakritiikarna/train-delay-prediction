'use strict';
const mongoose = require('mongoose');

const SecurityEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['login.failed'], index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, required: true, enum: ['invalid_credentials', 'inactive_account'] },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SecurityEventSchema.index({ createdAt: -1 });
SecurityEventSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('SecurityEvent', SecurityEventSchema);
