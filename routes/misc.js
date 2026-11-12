'use strict';
const express = require('express');
const { z } = require('zod');
const Disruption = require('../models/Disruption');
const Schedule = require('../models/Schedule');
const HistoricalDelay = require('../models/HistoricalDelay');
const ContactMessage = require('../models/ContactMessage');
const PredictionHistory = require('../models/PredictionHistory');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { paginate, pageMeta } = require('../utils/helpers');

const ON_TIME = ['On Time', 'On Track', 'Departed'];
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_FIELDS = { weather: '$weather', trainType: '$trainType', congestion: '$congestion', timeOfDay: '$timeOfDay', dayOfWeek: '$dayOfWeek' };

/** Prediction, analytics, contact form: smaller routers grouped together. */
module.exports = function miscRoutes({ limiters, ml, auth }) {
  const router = express.Router();

  router.post('/predictions', auth.optionalAuth, limiters.predict, validate({ body: schemas.prediction }), async (req, res) => {
    const prediction = await ml.predict(req.valid.body);
    if (req.user) {
      await PredictionHistory.create({
        user: req.user._id,
        inputs: req.valid.body,
        predictedDelay: prediction.predictedDelay,
        modelVersion: prediction.modelVersion,
        warnings: prediction.warnings,
      });
    }
    res.json(prediction);
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

  router.get('/analytics/routes', async (_req, res) => {
    const [schedules, disruptions] = await Promise.all([
      Schedule.aggregate([
        { $group: { _id: '$line', trainCount: { $sum: 1 }, averageDelay: { $avg: '$delay' }, statuses: { $push: '$status' } } },
        { $sort: { _id: 1 } },
      ]),
      Disruption.aggregate([
        { $match: { status: 'Active' } },
        { $group: { _id: '$line', activeDisruptions: { $sum: 1 }, averageDelay: { $avg: '$delay' } } },
      ]),
    ]);
    const disruptionByLine = new Map(disruptions.map((row) => [row._id, row]));
    res.json({ data: schedules.map((row) => ({
      line: row._id,
      trainCount: row.trainCount,
      averageDelay: Math.round((row.averageDelay || 0) * 10) / 10,
      activeDisruptions: disruptionByLine.get(row._id)?.activeDisruptions || 0,
      activeDisruptionAverageDelay: Math.round((disruptionByLine.get(row._id)?.averageDelay || 0) * 10) / 10,
    })) });
  });

  router.get('/analytics/train-performance', validate({ query: z.object({
    trainId: z.string().trim().min(1).max(20).optional(),
  }) }), async (req, res) => {
    const match = req.valid.query.trainId ? { trainId: req.valid.query.trainId } : {};
    const data = await Schedule.aggregate([
      { $match: match },
      { $group: {
        _id: '$trainId',
        line: { $last: '$line' },
        tripsRecorded: { $sum: 1 },
        averageDelay: { $avg: '$delay' },
        statuses: { $push: '$status' },
        mostRecent: { $max: '$updatedAt' },
      } },
      { $sort: { mostRecent: -1 } },
      { $limit: 100 },
    ]);
    res.json({ data: data.map((row) => ({
      trainId: row._id,
      line: row.line,
      tripsRecorded: row.tripsRecorded,
      averageDelay: Math.round((row.averageDelay || 0) * 10) / 10,
      onTimeRecords: row.statuses.filter((status) => ON_TIME.includes(status)).length,
      mostRecent: row.mostRecent,
    })) });
  });

  router.get('/analytics/model', async (_req, res) => {
    const info = await ml.modelInfo();
    res.json({
      ...info,
      evaluationDisclaimer: 'Offline evaluation on the bundled dataset only. Dataset provenance is unknown; these metrics are not operational accuracy.',
    });
  });

  router.get('/analytics/predictions/history', auth.requireAuth, validate({ query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }) }), async (req, res) => {
    const { page, limit } = req.valid.query;
    const filter = { user: req.user._id };
    const [data, total, summary] = await Promise.all([
      PredictionHistory.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      PredictionHistory.countDocuments(filter),
      PredictionHistory.aggregate([
        { $match: filter },
        { $group: { _id: '$modelVersion', count: { $sum: 1 }, averagePrediction: { $avg: '$predictedDelay' } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    res.json({
      data,
      summary: summary.map((row) => ({
        modelVersion: row._id || 'Unknown',
        predictions: row.count,
        averagePredictedDelay: Math.round(row.averagePrediction * 10) / 10,
      })),
      meta: pageMeta({ page, limit }, total),
    });
  });

  router.get('/map/overview', async (_req, res) => {
    const [trains, disruptions] = await Promise.all([
      Schedule.find().sort({ updatedAt: -1 }).limit(200).lean(),
      Disruption.find({ status: 'Active' }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    res.json({
      dataSource: 'recorded schedules and disruptions; schematic nodes and simulated train positions are illustrative only',
      trains: trains.map((train) => ({
        id: String(train._id),
        trainId: train.trainId,
        line: train.line,
        destination: train.destination || null,
        status: train.status,
        delay: train.delay || 0,
        scheduledDeparture: train.scheduledDeparture || train.scheduledTime || null,
      })),
      disruptions: disruptions.map(({ _id, trainId, line, cause, delay, severity }) => ({
        id: String(_id), trainId, line, cause, delay, severity,
      })),
      lines: [...new Set([...trains.map((train) => train.line), ...disruptions.map((disruption) => disruption.line)])].sort(),
    });
  });

  router.post('/contact', limiters.contact, validate({ body: schemas.contact }), async (req, res) => {
    await ContactMessage.create(req.valid.body);
    res.status(201).json({ message: 'Message received. Thank you!' });
  });

  return router;
};
