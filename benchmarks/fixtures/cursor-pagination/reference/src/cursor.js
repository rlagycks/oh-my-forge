'use strict';

/**
 * Opaque cursor encoding for keyset pagination.
 *
 * The payload carries the position keys (createdAt, id) so the next page can
 * start strictly after the last row without relying on an offset.
 */
function encodeCursor(row) {
  if (!row || typeof row !== 'object') throw new TypeError('row must be an object');
  if (typeof row.id !== 'string' || !Number.isFinite(row.createdAt)) {
    throw new TypeError('row must have a string id and a numeric createdAt');
  }

  const payload = JSON.stringify({ createdAt: row.createdAt, id: row.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor === '') throw new Error('invalid cursor');

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid cursor');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid cursor');
  if (typeof parsed.id !== 'string' || !Number.isFinite(parsed.createdAt)) throw new Error('invalid cursor');

  return { createdAt: parsed.createdAt, id: parsed.id };
}

module.exports = { encodeCursor, decodeCursor };
