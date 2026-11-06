'use strict';
const pino = require('pino');

function createLogger(env) {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    ...(env.isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  });
}

module.exports = { createLogger };
