'use strict';
const express = require('express');
const Schedule = require('../models/Schedule');
const Disruption = require('../models/Disruption');
const AuditLog = require('../models/AuditLog');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { paginate, pageMeta } = require('../utils/helpers');

module.exports = function operationsRoutes({ auth }) {
  const router = express.Router();
  router.use(...auth.requireRole('controller', 'admin'));

  router.get('/overview', async (_req, res) => {
    const [totalSchedules, activeDisruptions, scheduleStatuses, lineRows, scheduleLines, disruptionLines, destinationRows, disruptionStats] = await Promise.all([
      Schedule.countDocuments(),
      Disruption.countDocuments({ status: 'Active' }),
      Schedule.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Schedule.aggregate([
        { $group: { _id: '$line', destinations: { $addToSet: '$destination' }, trains: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Schedule.distinct('line'),
      Disruption.distinct('line'),
      Schedule.distinct('destination', { destination: { $type: 'string', $ne: '' } }),
      Disruption.aggregate([
        { $group: { _id: { status: '$status', severity: '$severity' }, count: { $sum: 1 }, avgDelay: { $avg: '$delay' } } },
        { $sort: { '_id.status': 1, '_id.severity': 1 } },
      ]),
    ]);

    const linesByName = new Map(lineRows.map((line) => [line._id, line]));
    for (const line of [...scheduleLines, ...disruptionLines]) {
      if (line && !linesByName.has(line)) linesByName.set(line, { _id: line, destinations: [], trains: 0 });
    }

    res.json({
      totalSchedules,
      activeDisruptions,
      scheduleStatuses: scheduleStatuses.map(({ _id, count }) => ({ status: _id || 'Unspecified', count })),
      lines: [...linesByName.values()].sort((a, b) => String(a._id || '').localeCompare(String(b._id || ''))).map((line) => ({
        line: line._id || 'Unspecified',
        trains: line.trains,
        destinations: line.destinations.filter((destination) => typeof destination === 'string' && destination.length > 0),
      })),
      recordedDestinations: destinationRows.filter((destination) => typeof destination === 'string' && destination.length > 0).sort(),
      disruptionAnalytics: disruptionStats.map((row) => ({
        status: row._id.status,
        severity: row._id.severity,
        count: row.count,
        averageDelay: Math.round(row.avgDelay * 10) / 10,
      })),
    });
  });

  router.get('/activity', validate({ query: schemas.admin.auditList }), async (req, res) => {
    const { page, limit } = req.valid.query;
    const filter = { entity: { $in: ['Schedule', 'Disruption'] } };
    const [data, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(paginate({ page, limit }).skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta({ page, limit }, total) });
  });

  return router;
};
