'use strict';
const { createHash } = require('node:crypto');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const templates = {
  'account-verification': ({ name, url }) => ({
    subject: 'Verify your TrainTrack AI account',
    text: `Hello ${name}, verify your account: ${url}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p><a href="${escapeHtml(url)}">Verify your TrainTrack AI account</a></p>`,
  }),
  'password-reset': ({ name, url }) => ({
    subject: 'Reset your TrainTrack AI password',
    text: `Hello ${name}, reset your password: ${url}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p><a href="${escapeHtml(url)}">Reset your password</a></p><p>This link expires in 30 minutes.</p>`,
  }),
  'password-changed': ({ name }) => ({
    subject: 'Your TrainTrack AI password was changed',
    text: `Hello ${name}, your password was changed. If this was not you, reset it immediately.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Your password was changed. If this was not you, reset it immediately.</p>`,
  }),
  'security-alert': ({ name, message }) => ({
    subject: 'TrainTrack AI security alert',
    text: `Hello ${name}, ${message}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>`,
  }),
  'disruption-alert': ({ name, message }) => ({
    subject: 'TrainTrack AI disruption alert',
    text: `Hello ${name}, ${message}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>`,
  }),
  'schedule-update': ({ name, message }) => ({
    subject: 'TrainTrack AI schedule update',
    text: `Hello ${name}, ${message}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p>`,
  }),
};

function createEmailService(env, logger) {
  async function send(user, templateName, data, dedupeKey) {
    const render = templates[templateName];
    if (!render) throw new Error(`Unknown email template: ${templateName}`);
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) return { status: 'not_configured' };

    const content = render({ name: user.name, ...data });
    const idempotencyKey = createHash('sha256').update(`${user._id}:${dedupeKey}`).digest('hex');
    let response;
    try {
      response = await fetch(env.EMAIL_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.EMAIL_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [user.email], ...content }),
        signal: AbortSignal.timeout(env.EMAIL_TIMEOUT_MS),
      });
    } catch (error) {
      logger.error({ event: 'email.request_failed', template: templateName, code: error.code || error.name }, 'Email provider request failed');
      return { status: 'failed' };
    }

    if (!response.ok) {
      logger.error({ event: 'email.provider_rejected', template: templateName, status: response.status }, 'Email provider rejected the request');
      return { status: 'failed' };
    }
    return { status: 'accepted' };
  }

  return { send };
}

module.exports = { createEmailService, templates };
