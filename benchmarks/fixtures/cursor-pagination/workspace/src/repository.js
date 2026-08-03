'use strict';

/**
 * In-memory row store standing in for a database table.
 *
 * Rows are { id: string, createdAt: number, title: string }.
 */
function createRepository(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');

  const stored = rows.map(row => ({ ...row }));

  return {
    /**
     * Return rows in the canonical listing order.
     *
     * @param {object} query
     * @param {number} query.offset
     * @param {number} query.limit
     * @returns {{rows: object[], total: number}}
     */
    findPage({ offset = 0, limit = 20 } = {}) {
      const ordered = [...stored].sort((a, b) => (
        b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      ));
      return {
        rows: ordered.slice(offset, offset + limit).map(row => ({ ...row })),
        total: ordered.length,
      };
    },

    count() {
      return stored.length;
    },
  };
}

module.exports = { createRepository };
