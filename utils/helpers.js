'use strict';

/** Escape user input before building a RegExp so `.*` or `(a+)+` can't be abused (ReDoS / wildcard search). */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" match across several fields. */
function searchFilter(search, fields) {
  const rx = new RegExp(escapeRegex(search), 'i');
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

/** Turn validated page/limit into skip/limit and the response meta block. */
function paginate({ page, limit }) {
  return { skip: (page - 1) * limit, limit };
}
function pageMeta({ page, limit }, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { escapeRegex, searchFilter, paginate, pageMeta };
