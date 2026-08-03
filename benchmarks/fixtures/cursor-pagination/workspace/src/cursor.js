'use strict';

/**
 * Cursor encoding for keyset pagination.
 *
 * Not implemented yet — pagination is still offset based.
 */
function encodeCursor(row) {
  return String(row.id);
}

function decodeCursor(cursor) {
  return { id: cursor };
}

module.exports = { encodeCursor, decodeCursor };
