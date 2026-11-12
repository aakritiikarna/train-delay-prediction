'use strict';
const mongoose = require('mongoose');

const AuthTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    purpose: { type: String, required: true, enum: ['email_verification', 'password_reset'] },
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: Date,
  },
  { timestamps: true }
);

AuthTokenSchema.index({ user: 1, purpose: 1, usedAt: 1 });

module.exports = mongoose.model('AuthToken', AuthTokenSchema);
