'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ContactMessage = require('../models/ContactMessage');
const SecurityEvent = require('../models/SecurityEvent');
const mongoose = require('mongoose');
const net = require('node:net');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { audit } = require('../services/audit');
const { searchFilter, paginate, pageMeta } = require('../utils/helpers');

module.exports = function adminRoutes({ env, auth, ml }) {
  const router = express.Router();
  router.use(...auth.requireRole('admin')); // every route below is admin-only

  const lastAdminGuard = async (user, change) => {
    // Prevent locking everybody out: the final active admin can't be demoted, deactivated or deleted.
    if (user.role !== 'admin' || !user.active) return;
    const losesAdmin = change.delete || change.role === 'passenger' || change.role === 'controller' || change.active === false;
    if (!losesAdmin) return;
    const remaining = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: user._id } });
    if (remaining === 0) throw new HttpError(400, 'At least one active admin must remain');
  };

  router.get('/users', validate({ query: schemas.users.list }), async (req, res) => {
    const { role, search, ...pg } = req.valid.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) Object.assign(filter, searchFilter(search, ['name', 'email']));
    const [data, total, roleCounts] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(paginate(pg).skip).limit(pg.limit),
      User.countDocuments(filter),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ]);
    const counts = Object.fromEntries(roleCounts.map((r) => [r._id, r.count]));
    res.json({ data, meta: pageMeta(pg, total), counts });
  });

  router.get('/overview', async (_req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, active, verified, recentLogins, failedLogins, roles] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ active: true }),
      User.countDocuments({ emailVerified: true }),
      User.countDocuments({ lastLoginAt: { $gte: since } }),
      SecurityEvent.countDocuments({ type: 'login.failed', createdAt: { $gte: since } }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ]);
    res.json({
      totalUsers: total,
      activeUsers: active,
      inactiveUsers: total - active,
      verifiedEmails: verified,
      unverifiedEmails: total - verified,
      usersLoggedInLast7Days: recentLogins,
      failedLoginsLast7Days: failedLogins,
      roleCounts: Object.fromEntries(roles.map((entry) => [entry._id, entry.count])),
    });
  });

  router.get('/system-health', async (_req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    const mlHealth = await ml.diagnostics();
    const smtp = await checkSmtp(env);
    const emailProvider = env.EMAIL_API_KEY && env.EMAIL_FROM ? 'configured' : 'not_configured';
    res.json({
      nodeApi: { status: 'available', uptimeSeconds: Math.round(process.uptime()), nodeVersion: process.version },
      mongodb: { status: dbReady ? 'connected' : 'disconnected' },
      flaskMlApi: { status: mlHealth.flask },
      catboostModel: { status: mlHealth.catboost },
      emailProvider: { status: emailProvider, check: 'configuration only' },
      smtp: { status: smtp, check: env.SMTP_HOST ? 'TCP connectivity' : 'configuration' },
    });
  });

  router.post('/users', validate({ body: schemas.users.create }), async (req, res) => {
    const { password, ...rest } = req.valid.body;
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await User.create({ ...rest, passwordHash });
    await audit(req, 'user.created', 'User', user._id, { email: user.email, role: user.role });
    res.status(201).json(user);
  });

  router.get('/users/:id', validate({ params: schemas.idParams }), async (req, res) => {
    const user = await User.findById(req.valid.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    const [auditLogs, securityEvents] = await Promise.all([
      AuditLog.find({ $or: [{ entity: 'User', entityId: String(user._id) }, { actor: user._id }] }).sort({ createdAt: -1 }).limit(10).lean(),
      SecurityEvent.find({ $or: [{ user: user._id }, { email: user.email }] }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    res.json({ user, auditLogs, securityEvents });
  });

  router.put('/users/:id', validate({ params: schemas.idParams, body: schemas.users.update }), async (req, res) => {
    const user = await User.findById(req.valid.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    const change = req.valid.body;
    if (String(user._id) === String(req.user._id) && (change.role && change.role !== 'admin' || change.active === false)) {
      throw new HttpError(400, 'You cannot demote or deactivate your own account');
    }
    await lastAdminGuard(user, change);
    const before = { role: user.role, active: user.active };
    const accessChanged = (change.role && change.role !== user.role) || (change.active !== undefined && change.active !== user.active);
    if (accessChanged) user.sessionVersion = (user.sessionVersion || 0) + 1;
    Object.assign(user, change);
    await user.save();
    if (accessChanged) req.app.get('io').in(`user:${user._id}`).disconnectSockets(true);
    await audit(req, 'user.updated', 'User', user._id, { before, after: change });
    res.json(user);
  });

  router.delete('/users/:id', validate({ params: schemas.idParams }), async (req, res) => {
    const user = await User.findById(req.valid.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    if (String(user._id) === String(req.user._id)) throw new HttpError(400, 'You cannot delete your own account');
    await lastAdminGuard(user, { delete: true });
    req.app.get('io').in(`user:${user._id}`).disconnectSockets(true);
    await user.deleteOne();
    await audit(req, 'user.deleted', 'User', user._id, { email: user.email });
    res.json({ message: 'Deleted' });
  });

  router.get('/audit-logs', validate({ query: schemas.admin.auditList }), async (req, res) => {
    const { page, limit, action, entity, search, from, to } = req.valid.query;
    const filter = {};
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (search) Object.assign(filter, searchFilter(search, ['actorEmail', 'action', 'entity']));
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.createdAt.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    const [data, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta({ page, limit }, total) });
  });

  router.get('/security-events', validate({ query: schemas.admin.securityEvents }), async (req, res) => {
    const { page, limit, search, from, to } = req.valid.query;
    const filter = {};
    if (search) Object.assign(filter, searchFilter(search, ['email', 'reason', 'ip']));
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to) filter.createdAt.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    }
    const [data, total] = await Promise.all([
      SecurityEvent.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      SecurityEvent.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta({ page, limit }, total) });
  });

  router.get('/messages', validate({ query: schemas.admin.messageList }), async (req, res) => {
    const { page, limit, read } = req.valid.query;
    const filter = read === undefined ? {} : { read: read === 'true' };
    const [data, total] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      ContactMessage.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta({ page, limit }, total) });
  });

  router.put('/messages/:id/read', validate({ params: schemas.idParams, body: schemas.admin.messageRead }), async (req, res) => {
    const message = await ContactMessage.findByIdAndUpdate(req.valid.params.id, { read: req.valid.body.read }, { returnDocument: 'after' });
    if (!message) throw new HttpError(404, 'Contact message not found');
    await audit(req, 'contact_message.read_status_changed', 'ContactMessage', message._id, { read: message.read });
    res.json(message);
  });

  return router;
};

function checkSmtp(env) {
  if (!env.SMTP_HOST) return Promise.resolve('not_configured');
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.SMTP_HOST, port: env.SMTP_PORT });
    const finish = (status) => {
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(env.SMTP_TIMEOUT_MS, () => finish('unreachable'));
    socket.once('connect', () => finish('reachable'));
    socket.once('error', () => finish('unreachable'));
  });
}
