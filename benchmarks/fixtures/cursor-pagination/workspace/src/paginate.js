'use strict';

const { encodeCursor } = require('./cursor.js');

const DEFAULT_LIMIT = 20;

/**
 * List rows one page at a time.
 *
 * @param {object} repository
 * @param {object} query
 * @param {number} [query.limit]
 * @param {string|null} [query.cursor]
 * @returns {{items: object[], nextCursor: string|null, hasMore: boolean}}
 */
function paginate(repository, { limit = DEFAULT_LIMIT, cursor = null } = {}) {
  // Offset pagination: the offset is derived from the cursor, which is just a
  // page number today. Rows inserted between requests shift every later page.
  const offset = cursor === null ? 0 : Number(cursor) * limit;
  const { rows, total } = repository.findPage({ offset, limit });

  const hasMore = offset + rows.length < total;
  const page = cursor === null ? 0 : Number(cursor);

  return {
    items: rows,
    nextCursor: hasMore ? encodeCursor({ id: String(page + 1) }) : null,
    hasMore,
  };
}

module.exports = { paginate, DEFAULT_LIMIT };
