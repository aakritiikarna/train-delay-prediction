'use strict';
const express = require('express');
const Notification = require('../models/Notification');
const { paginate, pageMeta } = require('../utils/helpers');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');

module.exports = function adminNotificationRoutes({ auth }) {
  const router = express.Router();
  router.use(...auth.requireRole('admin'));

  router.get('/overview', validate({ query: schemas.users.list.pick({ page: true, limit: true }) }), async (req, res) => {
    const { page, limit } = req.valid.query;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [total, unread, recent, emailStatuses, data] = await Promise.all([
      Notification.countDocuments(),
      Notification.countDocuments({ readAt: null }),
      Notification.countDocuments({ createdAt: { $gte: since } }),
      Notification.aggregate([{ $group: { _id: '$emailStatus', count: { $sum: 1 } } }]),
      Notification.find().sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).populate('user', 'name email').lean(),
    ]);
    res.json({
      total, unread, createdLast24Hours: recent,
      emailStatuses: Object.fromEntries(emailStatuses.map((entry) => [entry._id, entry.count])),
      data,
      meta: pageMeta({ page, limit }, total),
    });
  });

  return router;
};
