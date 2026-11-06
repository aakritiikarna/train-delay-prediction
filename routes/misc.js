'use strict';
const express = require('express');
const { z } = require('zod');
const Disruption = require('../models/Disruption');
const Schedule = require('../models/Schedule');
const HistoricalDelay = require('../models/HistoricalDelay');
const ContactMessage = require('../models/ContactMessage');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');

const ON_TIME = ['On Time', 'On Track', 'Departed'];
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_FIELDS = { weather: '$weather', trainType: '$trainType', congestion: '$congestion', timeOfDay: '$timeOfDay', dayOfWeek: '$dayOfWeek' };

/** Prediction, analytics, contact form: smaller routers grouped together. */
module.exports = function miscRoutes({ limiters, ml }) {
  const router = express.Router();

  router.post('/predictions', limiters.predict, validate({ body: schemas.prediction }), async (req, res) => {
    res.json(await ml.predict(req.valid.body));
  });

  // Headline numbers for both dashboards, computed server-side so they are always accurate.
  router.get('/stats', async (_req, res) => {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [active, totalTrains, onTimeTrains, resolved7d] = await Promise.all([
      Disruption.aggregate([
        { $match: { status: 'Active' } },
        { $group: { _id: null, count: { $sum: 1 }, avgDelay: { $avg: '$delay' } } },
      ]),
      Schedule.countDocuments(),
      Schedule.countDocuments({ status: { $in: ON_TIME } }),
      Disruption.countDocuments({ status: 'Resolved', resolvedAt: { $gte: since } }),
    ]);
    res.json({
      activeDisruptions: active[0]?.count ?? 0,
      avgActiveDelay: active[0] ? Math.round(active[0].avgDelay * 10) / 10 : 0,
      totalTrains,
      onTimeTrains,
      onTimeRate: totalTrains ? Math.round((onTimeTrains / totalTrains) * 100) : null,
      resolvedLast7Days: resolved7d,
    });
  });

  // Disruptions logged per day over the last 7 days (UTC), zero-filled.
  router.get('/analytics/daily', async (_req, res) => {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setTime(start.getTime() - 6 * DAY_MS);
    const rows = await Disruption.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, count: { $sum: 1 }, avgDelay: { $avg: '$delay' } } },
    ]);
    const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
    const data = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      return { date, count: byDay[date]?.count ?? 0, avgDelay: byDay[date] ? Math.round(byDay[date].avgDelay * 10) / 10 : 0 };
    });
    res.json({ data });
  });

  // Average historical delay grouped by a feature, computed from the imported training dataset.
  router.get('/analytics/historical', validate({ query: z.object({ groupBy: z.enum(Object.keys(GROUP_FIELDS)).default('trainType') }) }), async (req, res) => {
    const { groupBy } = req.valid.query;
    const rows = await HistoricalDelay.aggregate([
      { $group: { _id: GROUP_FIELDS[groupBy], avgDelay: { $avg: '$delayMin' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ groupBy, data: rows.map((r) => ({ label: r._id, avgDelay: Math.round(r.avgDelay * 10) / 10, count: r.count })) });
  });

  router.post('/contact', limiters.contact, validate({ body: schemas.contact }), async (req, res) => {
    await ContactMessage.create(req.valid.body);
    res.status(201).json({ message: 'Message received. Thank you!' });
  });

  return router;
};
