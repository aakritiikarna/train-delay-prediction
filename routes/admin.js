'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ContactMessage = require('../models/ContactMessage');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { audit } = require('../services/audit');
const { searchFilter, paginate, pageMeta } = require('../utils/helpers');

module.exports = function adminRoutes({ env, auth }) {
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

  router.post('/users', validate({ body: schemas.users.create }), async (req, res) => {
    const { password, ...rest } = req.valid.body;
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await User.create({ ...rest, passwordHash });
    await audit(req, 'user.created', 'User', user._id, { email: user.email, role: user.role });
    res.status(201).json(user);
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
    Object.assign(user, change);
    await user.save();
    await audit(req, 'user.updated', 'User', user._id, { before, after: change });
    res.json(user);
  });

  router.delete('/users/:id', validate({ params: schemas.idParams }), async (req, res) => {
    const user = await User.findById(req.valid.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    if (String(user._id) === String(req.user._id)) throw new HttpError(400, 'You cannot delete your own account');
    await lastAdminGuard(user, { delete: true });
    await user.deleteOne();
    await audit(req, 'user.deleted', 'User', user._id, { email: user.email });
    res.json({ message: 'Deleted' });
  });

  router.get('/audit-logs', validate({ query: schemas.users.list.pick({ page: true, limit: true }) }), async (req, res) => {
    const pg = req.valid.query;
    const [data, total] = await Promise.all([
      AuditLog.find().sort({ createdAt: -1 }).skip(paginate(pg).skip).limit(pg.limit).lean(),
      AuditLog.countDocuments(),
    ]);
    res.json({ data, meta: pageMeta(pg, total) });
  });

  router.get('/messages', validate({ query: schemas.users.list.pick({ page: true, limit: true }) }), async (req, res) => {
    const pg = req.valid.query;
    const [data, total] = await Promise.all([
      ContactMessage.find().sort({ createdAt: -1 }).skip(paginate(pg).skip).limit(pg.limit).lean(),
      ContactMessage.countDocuments(),
    ]);
    res.json({ data, meta: pageMeta(pg, total) });
  });

  return router;
};
