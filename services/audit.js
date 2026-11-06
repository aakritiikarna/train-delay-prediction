'use strict';
const AuditLog = require('../models/AuditLog');

/** Records who did what. Failures are logged but never break the request being audited. */
async function audit(req, action, entity, entityId, details) {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      actorEmail: req.user?.email,
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      details,
    });
  } catch (err) {
    req.log?.error({ err, action }, 'Failed to write audit log');
  }
}

module.exports = { audit };
