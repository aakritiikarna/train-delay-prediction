'use strict';
const mongoose = require('mongoose');

const ROLES = ['passenger', 'controller', 'admin'];

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Never returned by default; select explicitly (+passwordHash) only when verifying a login.
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'passenger', index: true },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

UserSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', UserSchema);
