'use strict';
const express = require('express');
const Schedule = require('../models/Schedule');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { audit } = require('../services/audit');
const { searchFilter, paginate, pageMeta } = require('../utils/helpers');

module.exports = function scheduleRoutes({ auth }) {
  const router = express.Router();
  const staff = auth.requireRole('controller', 'admin');

  // Public: passengers see the timetable.
  router.get('/', validate({ query: schemas.schedules.list }), async (req, res) => {
    const { line, status, search, ...pg } = req.valid.query;
    const filter = {};
    if (line) filter.line = line;
    if (status) filter.status = status;
    if (search) Object.assign(filter, searchFilter(search, ['trainId', 'destination', 'driver']));
    const [data, total] = await Promise.all([
      Schedule.find(filter).sort({ scheduledTime: 1 }).skip(paginate(pg).skip).limit(pg.limit).lean(),
      Schedule.countDocuments(filter),
    ]);
    res.json({ data, meta: pageMeta(pg, total) });
  });

  router.post('/', staff, validate({ body: schemas.schedules.create }), async (req, res) => {
    const doc = await Schedule.create(req.valid.body);
    req.app.get('io').emit('scheduleCreated', doc);
    await audit(req, 'schedule.created', 'Schedule', doc._id, { trainId: doc.trainId });
    res.status(201).json(doc);
  });

  router.put('/:id', staff, validate({ params: schemas.idParams, body: schemas.schedules.update }), async (req, res) => {
    const doc = await Schedule.findByIdAndUpdate(req.valid.params.id, req.valid.body, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!doc) throw new HttpError(404, 'Schedule not found');
    req.app.get('io').emit('scheduleUpdated', doc);
    await audit(req, 'schedule.updated', 'Schedule', doc._id, req.valid.body);
    res.json(doc);
  });

  router.delete('/:id', ...auth.requireRole('admin'), validate({ params: schemas.idParams }), async (req, res) => {
    const doc = await Schedule.findByIdAndDelete(req.valid.params.id);
    if (!doc) throw new HttpError(404, 'Schedule not found');
    req.app.get('io').emit('scheduleDeleted', { _id: doc._id });
    await audit(req, 'schedule.deleted', 'Schedule', doc._id, { trainId: doc.trainId });
    res.json({ message: 'Deleted' });
  });

  return router;
};
