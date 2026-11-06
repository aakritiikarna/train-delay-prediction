'use strict';
const { rateLimit } = require('express-rate-limit');

/** Builds the per-route limiters. Disabled in tests unless explicitly enabled. */
function createLimiters(env) {
  const make = (windowMs, limit, message) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => !env.rateLimitEnabled,
      message: { error: message },
    });
  const MIN = 60 * 1000;
  return {
    api: make(15 * MIN, 600, 'Too many requests, please slow down.'),
    auth: make(15 * MIN, 20, 'Too many login attempts. Try again in 15 minutes.'),
    predict: make(MIN, 30, 'Too many prediction requests. Try again in a minute.'),
    contact: make(60 * MIN, 5, 'Too many messages sent. Try again later.'),
  };
}

module.exports = createLimiters;
