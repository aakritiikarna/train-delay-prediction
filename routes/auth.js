'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SecurityEvent = require('../models/SecurityEvent');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');
const AuthToken = require('../models/AuthToken');
const { createHash, randomBytes } = require('node:crypto');

module.exports = function authRoutes({ env, auth, limiters, email, notifications }) {
  const router = express.Router();
  const mailer = email;
  const hashToken = (token) => createHash('sha256').update(token).digest('hex');
  const createToken = async (user, purpose, lifetimeMs) => {
    const token = randomBytes(32).toString('base64url');
    await AuthToken.updateMany({ user: user._id, purpose, usedAt: null }, { $set: { usedAt: new Date() } });
    await AuthToken.create({ user: user._id, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + lifetimeMs) });
    return token;
  };
  // A fixed hash so unknown-email logins cost the same as wrong-password ones (no timing leak).
  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

  // Public self-registration ALWAYS creates a passenger. Controller/admin roles can only be
  // granted by an existing admin (see routes/admin.js).
  router.post('/register', limiters.auth, validate({ body: schemas.auth.register }), async (req, res) => {
    const { name, email, password } = req.valid.body;
    if (await User.exists({ email })) throw new HttpError(409, 'An account with that email already exists');
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, role: 'passenger', emailVerified: false });
    const token = await createToken(user, 'email_verification', 24 * 60 * 60 * 1000);
    const emailResult = await mailer.send(user, 'account-verification', {
      url: `${env.PUBLIC_BASE_URL}/login?verifyToken=${encodeURIComponent(token)}`,
    }, `verify:${user._id}:${token}`);
    await notifications.create(user, {
      type: 'account',
      title: 'Verify your email address',
      message: emailResult.status === 'accepted'
        ? 'Check your email for an account verification link.'
        : 'Email verification could not be sent. Contact an administrator to verify your account.',
      dedupeKey: `account-verification:${user._id}`,
      emailStatus: emailResult.status,
    });
    res.cookie(auth.COOKIE, auth.sign(user), auth.cookieOptions);
    res.status(201).json({ user, email: emailResult });
  });

  router.post('/login', limiters.auth, validate({ body: schemas.auth.login }), async (req, res) => {
    const { email, password } = req.valid.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !ok) {
      await SecurityEvent.create({
        type: 'login.failed',
        email,
        user: user?._id,
        reason: 'invalid_credentials',
        ip: req.ip,
      });
      throw new HttpError(401, 'Invalid email or password');
    }
    if (!user.active) {
      await SecurityEvent.create({
        type: 'login.failed',
        email,
        user: user._id,
        reason: 'inactive_account',
        ip: req.ip,
      });
      throw new HttpError(403, 'This account has been deactivated');
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.cookie(auth.COOKIE, auth.sign(user), auth.cookieOptions);
    res.json({ user });
  });

  router.post('/logout', auth.optionalAuth, async (req, res) => {
    if (req.user) {
      req.user.sessionVersion = (req.user.sessionVersion || 0) + 1;
      await req.user.save();
      req.app.get('io').in(`user:${req.user._id}`).disconnectSockets(true);
    }
    res.clearCookie(auth.COOKIE, { ...auth.cookieOptions, maxAge: undefined });
    res.json({ message: 'Logged out' });
  });

  router.get('/me', auth.requireAuth, (req, res) => res.json({ user: req.user }));

  router.post('/verify-email', validate({ body: schemas.auth.emailToken }), async (req, res) => {
    const record = await AuthToken.findOne({
      tokenHash: hashToken(req.valid.body.token), purpose: 'email_verification', usedAt: null, expiresAt: { $gt: new Date() },
    });
    if (!record) throw new HttpError(400, 'Verification link is invalid or expired');
    const user = await User.findById(record.user);
    if (!user || !user.active) throw new HttpError(400, 'Verification link is invalid or expired');
    user.emailVerified = true;
    await user.save();
    record.usedAt = new Date();
    await record.save();
    res.json({ message: 'Email address verified' });
  });

  router.post('/password-reset/request', limiters.auth, validate({ body: schemas.auth.requestReset }), async (req, res) => {
    const user = await User.findOne({ email: req.valid.body.email, active: true });
    if (user) {
      const token = await createToken(user, 'password_reset', 30 * 60 * 1000);
      const result = await mailer.send(user, 'password-reset', {
        url: `${env.PUBLIC_BASE_URL}/login?resetToken=${encodeURIComponent(token)}`,
      }, `password-reset:${user._id}:${token}`);
      if (result.status !== 'accepted') {
        req.log?.error({ event: 'password_reset.email_failed', status: result.status }, 'Password reset email was not accepted');
      }
    }
    res.status(202).json({ message: 'If the account exists, password reset instructions will be sent.' });
  });

  router.post('/password-reset/complete', limiters.auth, validate({ body: schemas.auth.resetPassword }), async (req, res) => {
    const record = await AuthToken.findOne({
      tokenHash: hashToken(req.valid.body.token), purpose: 'password_reset', usedAt: null, expiresAt: { $gt: new Date() },
    });
    if (!record) throw new HttpError(400, 'Password reset link is invalid or expired');
    const user = await User.findOne({ _id: record.user, active: true }).select('+passwordHash');
    if (!user) throw new HttpError(400, 'Password reset link is invalid or expired');
    user.passwordHash = await bcrypt.hash(req.valid.body.password, env.BCRYPT_ROUNDS);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    record.usedAt = new Date();
    await record.save();
    await AuthToken.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
    req.app.get('io').in(`user:${user._id}`).disconnectSockets(true);
    const notificationResult = await notifications.notifySecurity(user, {
      title: 'Password changed',
      message: 'Your password was reset. If you did not make this change, contact support immediately.',
      dedupeKey: `password-reset:${user.sessionVersion}`,
      emailTemplate: 'password-changed',
    });
    res.json({ message: 'Password updated. Existing sessions have been signed out.', email: { status: notificationResult.emailStatus } });
  });

  router.post('/password/change', auth.requireAuth, validate({ body: schemas.auth.changePassword }), async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !await bcrypt.compare(req.valid.body.currentPassword, user.passwordHash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    user.passwordHash = await bcrypt.hash(req.valid.body.password, env.BCRYPT_ROUNDS);
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();
    req.app.get('io').in(`user:${user._id}`).disconnectSockets(true);
    const notificationResult = await notifications.notifySecurity(user, {
      title: 'Password changed',
      message: 'Your password was changed. If you did not make this change, reset it immediately.',
      dedupeKey: `password-change:${user.sessionVersion}`,
      emailTemplate: 'password-changed',
    });
    res.json({
      message: 'Password changed. Your other sessions have been signed out.',
      email: { status: notificationResult.emailStatus },
    });
  });

  return router;
};
