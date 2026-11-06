'use strict';
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: String,
    action: { type: String, required: true, index: true }, // e.g. "user.role_changed"
    entity: { type: String, required: true }, // e.g. "User", "Disruption"
    entityId: String,
    details: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
