'use strict';
const { z } = require('zod');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const WEATHER = ['Clear', 'Rainy', 'Foggy'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMES_OF_DAY = ['Morning', 'Afternoon', 'Evening', 'Night'];
const TRAIN_TYPES = ['Express', 'Superfast', 'Local'];
const CONGESTION = ['Low', 'Medium', 'High'];

const text = (max) => z.string().trim().min(1).max(max);
const hhmm = z.string().regex(HHMM, 'Time must be HH:MM (24h)');
const date = z.string().regex(YYYY_MM_DD, 'Date must be YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Date must be a valid calendar date');
const delayMinutes = z.coerce.number().int().min(0).max(1440);

const idParams = z.object({ id: z.string().regex(OBJECT_ID, 'Invalid id') });

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
};

const auth = {
  register: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.email().max(254),
    // bcrypt only uses the first 72 bytes, so cap there rather than silently truncating.
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  }),
  login: z.object({ email: z.email().max(254), password: z.string().min(1).max(72) }),
  emailToken: z.object({ token: z.string().min(32).max(256) }),
  requestReset: z.object({ email: z.email().max(254) }),
  resetPassword: z.object({
    token: z.string().min(32).max(256),
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  }),
  changePassword: z.object({
    currentPassword: z.string().min(1).max(72),
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  }),
};

const notificationPreferences = z.object({
  inAppDisruptions: z.boolean().optional(),
  inAppScheduleUpdates: z.boolean().optional(),
  disruptionEmails: z.boolean().optional(),
  scheduleEmails: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one preference to update' });

const disruptions = {
  list: z.object({
    line: text(40).optional(),
    status: z.enum(['Active', 'Resolved']).optional(),
    search: text(50).optional(),
    ...pagination,
  }),
  create: z.object({
    trainId: text(20),
    line: text(40),
    cause: text(120),
    delay: delayMinutes,
    severity: z.enum(['Critical', 'Moderate', 'Minor']).optional(),
  }),
};

const scheduleFields = {
  trainId: text(20),
  line: text(40),
  scheduledDate: date,
  scheduledTime: hhmm,
  actualTime: hhmm,
  scheduledDeparture: hhmm,
  scheduledArrival: hhmm,
  delay: delayMinutes,
  destination: text(80),
  driver: text(80),
  status: z.enum(['On Time', 'On Track', 'Departed', 'Delayed', 'Critical', 'Cancelled']),
};

const schedules = {
  list: z.object({
    line: text(40).optional(),
    status: scheduleFields.status.optional(),
    search: text(50).optional(),
    ...pagination,
  }),
  create: z.object({ ...scheduleFields }).partial().required({ trainId: true, line: true }),
  // Only these fields can be changed through the API (no mass assignment).
  update: z.object({ ...scheduleFields }).partial().refine((o) => Object.keys(o).length > 0, {
    message: 'Provide at least one field to update',
  }),
};

const users = {
  list: z.object({
    role: z.enum(['passenger', 'controller', 'admin']).optional(),
    search: text(50).optional(),
    ...pagination,
  }),
  create: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.email().max(254),
    role: z.enum(['passenger', 'controller', 'admin']).default('passenger'),
    password: z.string().min(8).max(72),
  }),
  update: z
    .object({
      name: z.string().trim().min(2).max(80),
      role: z.enum(['passenger', 'controller', 'admin']),
      active: z.boolean(),
    })
    .partial()
    .refine((o) => Object.keys(o).length > 0, { message: 'Provide at least one field to update' }),
};

const admin = {
    auditList: z.object({
      action: text(80).optional(),
      entity: text(40).optional(),
      search: text(100).optional(),
      from: date.optional(),
      to: date.optional(),
      ...pagination,
    }),
    messageList: z.object({
      read: z.enum(['true', 'false']).optional(),
      ...pagination,
    }),
    messageRead: z.object({ read: z.boolean() }),
    securityEvents: z.object({
      search: text(100).optional(),
      from: date.optional(),
      to: date.optional(),
      ...pagination,
    }),
};

const prediction = z.object({
  trainType: z.enum(TRAIN_TYPES),
  weather: z.enum(WEATHER),
  timeOfDay: z.enum(TIMES_OF_DAY),
  congestion: z.enum(CONGESTION),
  day: z.enum(DAYS),
  distance: z.coerce.number().min(0).max(2000),
});

const contact = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254),
  message: z.string().trim().min(10).max(2000),
});

module.exports = {
  idParams, auth, disruptions, schedules, users, admin, prediction, contact, notificationPreferences,
  enums: { WEATHER, DAYS, TIMES_OF_DAY, TRAIN_TYPES, CONGESTION },
};
