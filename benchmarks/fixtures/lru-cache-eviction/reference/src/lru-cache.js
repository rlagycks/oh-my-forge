'use strict';

/**
 * Least-recently-used cache with a fixed capacity.
 *
 * Recency is carried by Map insertion order: re-inserting a key moves it to the
 * end, so the first key in iteration order is always the least recently used.
 *
 * @param {number} capacity Maximum number of entries.
 */
function createLruCache(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new TypeError('capacity must be a positive integer');
  }

  const entries = new Map();

  function touch(key, value) {
    entries.delete(key);
    entries.set(key, value);
  }

  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      touch(key, value);
      return value;
    },

    set(key, value) {
      touch(key, value);
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
