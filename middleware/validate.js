'use strict';

/**
 * validate({ body, query, params }) parses each part with a zod schema and stores the
 * cleaned result on `req.valid`. (Express 5 makes `req.query` read-only, so we never
 * assign back to it.) Unknown fields are stripped, which also prevents mass assignment.
 */
const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    req.valid[part] = schemas[part].parse(req[part] ?? {}); // ZodError handled by errorHandler
  }
  next();
};

module.exports = validate;
