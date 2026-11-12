'use strict';
const mongoose = require('mongoose');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['On Time', 'On Track', 'Departed', 'Delayed', 'Critical', 'Cancelled'];
const timeField = { type: String, match: [HHMM, 'Time must be in HH:MM (24h) format'] };
const dateField = {
  type: String,
  match: [YYYY_MM_DD, 'Date must be in YYYY-MM-DD format'],
  validate: {
    validator: (value) => {
      if (!value) return true;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    },
    message: 'Date must be a valid calendar date',
  },
};

const ScheduleSchema = new mongoose.Schema(
  {
    trainId: { type: String, required: true, trim: true, maxlength: 20 },
    line: { type: String, required: true, trim: true, maxlength: 40 },
    scheduledDate: dateField,
    scheduledTime: timeField, // controller dashboard: planned departure
    actualTime: timeField, // controller dashboard: actual departure
    scheduledDeparture: timeField, // passenger dashboard
    scheduledArrival: timeField, // passenger dashboard
    delay: { type: Number, default: 0, min: 0, max: 1440 },
    destination: { type: String, trim: true, maxlength: 80 },
    driver: { type: String, trim: true, maxlength: 80 },
    status: { type: String, enum: STATUSES, default: 'On Time' },
  },
  { timestamps: true }
);

ScheduleSchema.index({ trainId: 1 });
ScheduleSchema.index({ status: 1, scheduledTime: 1 });
ScheduleSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Schedule', ScheduleSchema);
