'use strict';
const express = require('express');
const Disruption = require('../models/Disruption');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { audit } = require('../services/audit');
const { searchFilter, paginate, pageMeta } = require('../utils/helpers');

module.exports = function disruptionRoutes({ auth }) {
  const router = express.Router();
  const staff = auth.requireRole('controller', 'admin');

  // Public: passengers see live disruptions.
  router.get('/', validate({ query: schemas.disruptions.list }), async (req, res) => {
    const { line, status, search, ...pg } = req.valid.query;
    const filter = {};
    if (line) filter.line = line;
    if (status) filter.status = status;
    if (search) Object.assign(filter, searchFilter(search, ['trainId', 'cause', 'line']));
    const [data, total] = await Promise.all([
      Disruption.find(filter).sort({ createdAt: -1 }).skip(paginate(pg).skip).limit(pg.limit).lean(),
      Disruption.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta(pg, total) });
  });

  router.post('/', staff, validate({ body: schemas.disruptions.create }), async (req, res) => {
    const doc = await Disruption.create({ ...req.valid.body, reportedBy: req.user._id });
    req.app.get('io').emit('new-disruption', doc); // real-time alert to all dashboards
    await audit(req, 'disruption.created', 'Disruption', doc._id, { trainId: doc.trainId, line: doc.line });
    res.status(201).json(doc);
  });

  router.put('/:id/resolve', staff, validate({ params: schemas.idParams }), async (req, res) => {
    const doc = await Disruption.findByIdAndUpdate(
      req.valid.params.id,
      { status: 'Resolved', resolvedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!doc) throw new HttpError(404, 'Disruption not found');
    req.app.get('io').emit('disruption-resolved', doc);
    await audit(req, 'disruption.resolved', 'Disruption', doc._id);
    res.json(doc);
  });

  router.delete('/:id', ...auth.requireRole('admin'), validate({ params: schemas.idParams }), async (req, res) => {
    const doc = await Disruption.findByIdAndDelete(req.valid.params.id);
    if (!doc) throw new HttpError(404, 'Disruption not found');
    req.app.get('io').emit('disruption-deleted', { _id: doc._id });
    await audit(req, 'disruption.deleted', 'Disruption', doc._id, { trainId: doc.trainId });
    res.json({ message: 'Deleted' });
  });

  return router;
};
