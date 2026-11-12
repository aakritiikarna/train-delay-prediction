'use strict';
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, maxlength: 60 },
    title: { type: String, required: true, maxlength: 120 },
    message: { type: String, required: true, maxlength: 500 },
    href: { type: String, maxlength: 240 },
    dedupeKey: { type: String, required: true, maxlength: 180 },
    readAt: Date,
    emailStatus: { type: String, enum: ['not_requested', 'not_configured', 'accepted', 'failed'], default: 'not_requested' },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true });
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, readAt: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);
