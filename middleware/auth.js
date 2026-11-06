'use strict';
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const HttpError = require('../utils/HttpError');

const COOKIE = 'token';

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[COOKIE] || null;
}

/**
 * Builds the auth helpers for a given config. The user is re-loaded from the database on
 * every request, so deactivating a user or changing their role takes effect immediately
 * instead of waiting for the token to expire.
 */
function createAuth(env) {
  const sign = (user) => jwt.sign({ sub: String(user._id) }, env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN,
  });

  const cookieOptions = {
    httpOnly: true, // not readable by page JavaScript, limits the impact of XSS
    sameSite: 'lax', // blocks the cookie on cross-site POST/PUT/DELETE (CSRF)
    secure: env.isProd,
    maxAge: env.COOKIE_MAX_AGE_MS,
    path: '/',
  };

  async function loadUser(req) {
    const token = extractToken(req);
    if (!token) return null;
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(payload.sub);
    return user && user.active ? user : null;
  }

  const requireAuth = async (req, _res, next) => {
    try {
      const user = await loadUser(req);
      if (!user) throw new HttpError(401, 'Authentication required');
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireRole = (...roles) => [
    requireAuth,
    (req, _res, next) =>
      roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to do that')),
  ];

  /** For HTML pages: redirect to /login instead of returning JSON. */
  const pageGuard = (...roles) => async (req, res, next) => {
    try {
      const user = await loadUser(req).catch(() => null);
      if (user && roles.includes(user.role)) return next();
      return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
    } catch (err) {
      return next(err);
    }
  };

  return { sign, cookieOptions, COOKIE, requireAuth, requireRole, pageGuard };
}

module.exports = createAuth;
