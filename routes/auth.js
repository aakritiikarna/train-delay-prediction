'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const HttpError = require('../utils/HttpError');
const validate = require('../middleware/validate');
const schemas = require('../validation/schemas');

module.exports = function authRoutes({ env, auth, limiters }) {
  const router = express.Router();
  // A fixed hash so unknown-email logins cost the same as wrong-password ones (no timing leak).
  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

  // Public self-registration ALWAYS creates a passenger. Controller/admin roles can only be
  // granted by an existing admin (see routes/admin.js).
  router.post('/register', limiters.auth, validate({ body: schemas.auth.register }), async (req, res) => {
    const { name, email, password } = req.valid.body;
    if (await User.exists({ email })) throw new HttpError(409, 'An account with that email already exists');
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, role: 'passenger' });
    res.cookie(auth.COOKIE, auth.sign(user), auth.cookieOptions);
    res.status(201).json({ user });
  });

  router.post('/login', limiters.auth, validate({ body: schemas.auth.login }), async (req, res) => {
    const { email, password } = req.valid.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
    if (!user.active) throw new HttpError(403, 'This account has been deactivated');
    user.lastLoginAt = new Date();
    await user.save();
    res.cookie(auth.COOKIE, auth.sign(user), auth.cookieOptions);
    res.json({ user });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(auth.COOKIE, { ...auth.cookieOptions, maxAge: undefined });
    res.json({ message: 'Logged out' });
  });

  router.get('/me', auth.requireAuth, (req, res) => res.json({ user: req.user }));

  return router;
};
