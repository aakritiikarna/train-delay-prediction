'use strict';
const Notification = require('../models/Notification');
const User = require('../models/User');

function createNotificationService(io, email) {
  async function create(user, values) {
    let result;
    try {
      result = await Notification.updateOne(
        { user: user._id, dedupeKey: values.dedupeKey },
        { $setOnInsert: { ...values, user: user._id } },
        { upsert: true }
      );
    } catch (error) {
      if (error.code === 11000) return null;
      throw error;
    }
    if (!result.upsertedCount) return null;
    const notification = await Notification.findOne({ user: user._id, dedupeKey: values.dedupeKey }).lean();
    io.to(`user:${user._id}`).emit('notification:new', notification);
    io.to('role:admin').emit('admin:notification-count', { userId: String(user._id) });
    return notification;
  }

  async function notifyOptional(event, details) {
    const { users, type, title, message, href, emailTemplate, emailEnabled } = event;
    const failures = [];
    for (const user of users) {
      const notification = await create(user, {
        type,
        title,
        message,
        href,
        dedupeKey: details.dedupeKey,
        emailStatus: emailEnabled && user.preferences?.[emailEnabled] ? 'not_configured' : 'not_requested',
      });
      if (!notification) continue;
      if (emailEnabled && user.preferences?.[emailEnabled]) {
        const status = await email.send(user, emailTemplate, { message }, details.dedupeKey);
        if (status.status !== 'accepted') failures.push(status.status);
        await Notification.updateOne({ _id: notification._id, user: user._id }, { $set: { emailStatus: status.status } });
      }
    }
    return { emailFailures: failures.length };
  }

  async function notifySecurity(user, { title, message, dedupeKey, emailTemplate = 'security-alert' }) {
    const notification = await create(user, { type: 'security', title, message, dedupeKey });
    if (!notification) return { created: false, emailStatus: 'not_requested' };
    const result = await email.send(user, emailTemplate, { message }, dedupeKey);
    await Notification.updateOne({ _id: notification._id, user: user._id }, { $set: { emailStatus: result.status } });
    return { created: true, emailStatus: result.status };
  }

  async function notifyUsersWithPreference({ preference, emailPreference, ...event }, dedupeKey) {
    const query = { active: true };
    query[`preferences.${preference}`] = { $ne: false };
    const users = await User.find(query).select('name email preferences');
    return notifyOptional({
      users,
      ...event,
      emailEnabled: emailPreference,
    }, { dedupeKey });
  }

  return { create, notifyOptional, notifySecurity, notifyUsersWithPreference };
}

module.exports = createNotificationService;
