'use strict';

/**
 * Least-recently-used cache with a fixed capacity.
 *
 * @param {number} capacity Maximum number of entries.
 */
function createLruCache(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new TypeError('capacity must be a positive integer');
  }

  const entries = new Map();

  return {
    get(key) {
      return entries.get(key);
    },

    set(key, value) {
      entries.set(key, value);
      if (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
      return this;
    },

    has(key) {
      return entries.has(key);
    },

    get size() {
      return entries.size;
    },
  };
}

module.exports = { createLruCache };
