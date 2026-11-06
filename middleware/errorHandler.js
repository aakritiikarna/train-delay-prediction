'use strict';
const { ZodError } = require('zod');
const mongoose = require('mongoose');
const HttpError = require('../utils/HttpError');

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return next();
}

// Express recognises error middleware by its 4-argument signature; `next` must stay.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message;
  let details = err.details;

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation failed';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = 'A record with that value already exists';
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Invalid or expired session';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  }

  // Deliberate HttpErrors (e.g. 502/503 from the ML client) keep their friendly message;
  // anything unexpected is logged and masked so internals never reach the client.
  if (status >= 500 && !(err instanceof HttpError)) {
    req.log?.error({ err }, 'Unhandled error');
    message = 'Internal server error';
    details = undefined;
  }
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

module.exports = { notFound, errorHandler };
