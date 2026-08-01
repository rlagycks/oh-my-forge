'use strict';

/**
 * Built-in defaults. See docs/CONFIG.md.
 */
const DEFAULTS = {
  port: 8080,
  host: 'localhost',
  cache: {
    enabled: true,
    ttl: 300,
  },
  origins: ['https://example.com'],
};

module.exports = { DEFAULTS };
