'use strict';
const express = require('express');
const { z } = require('zod');
const Notification = require('../models/Notification');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { paginate, pageMeta } = require('../utils/helpers');

module.exports = function notificationRoutes({ auth }) {
  const router = express.Router();
  router.use(auth.requireAuth);

  router.get('/', validate({ query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    unread: z.enum(['true', 'false']).optional(),
  }) }), async (req, res) => {
    const { page, limit, unread } = req.valid.query;
    const filter = { user: req.user._id };
    if (unread === 'true') filter.readAt = null;
    if (unread === 'false') filter.readAt = { $ne: null };
    const [data, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, readAt: null }),
    ]);
    res.json({ data, unreadCount, meta: pageMeta({ page, limit }, total) });
  });

  router.get('/unread-count', async (req, res) => {
    const count = await Notification.countDocuments({ user: req.user._id, readAt: null });
    res.json({ count });
  });

  router.put('/read-all', async (req, res) => {
    const result = await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ updated: result.modifiedCount });
  });

  router.put('/:id/read', validate({ params: schemas.idParams }), async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.valid.params.id, user: req.user._id },
      { $set: { readAt: new Date() } },
      { returnDocument: 'after' }
    ).lean();
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification });
  });

  router.get('/preferences', (req, res) => {
    res.json({ preferences: req.user.preferences });
  });

  router.put('/preferences', validate({ body: schemas.notificationPreferences }), async (req, res) => {
    for (const [key, value] of Object.entries(req.valid.body)) req.user.set(`preferences.${key}`, value);
    await req.user.save();
    res.json({ preferences: req.user.preferences });
  });

  return router;
};
