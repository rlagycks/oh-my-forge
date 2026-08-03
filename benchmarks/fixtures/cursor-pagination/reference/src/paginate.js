'use strict';

const { encodeCursor, decodeCursor } = require('./cursor.js');

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function clampLimit(limit) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)));
}

/**
 * True when `row` sorts strictly after `position` under
 * (createdAt desc, id desc).
 */
function isAfter(row, position) {
  if (row.createdAt !== position.createdAt) return row.createdAt < position.createdAt;
  return row.id < position.id;
}

/**
 * List rows one page at a time using keyset pagination.
 *
 * findPage is offset based and its signature is fixed, so the ordered set is
 * read once and the keyset predicate is applied here. The page boundary comes
 * from the cursor keys, never from an offset, so inserts between requests
 * cannot shift a later page.
 *
 * @returns {{items: object[], nextCursor: string|null, hasMore: boolean}}
 */
function paginate(repository, { limit = DEFAULT_LIMIT, cursor = null } = {}) {
  const pageSize = clampLimit(limit);
  const position = cursor === null || cursor === undefined ? null : decodeCursor(cursor);

  const { rows } = repository.findPage({ offset: 0, limit: repository.count() });
  const eligible = position === null ? rows : rows.filter(row => isAfter(row, position));

  const items = eligible.slice(0, pageSize);
  const hasMore = eligible.length > items.length;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    hasMore,
  };
}

module.exports = { paginate, DEFAULT_LIMIT };
