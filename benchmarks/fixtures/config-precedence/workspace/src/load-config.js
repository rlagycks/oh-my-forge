'use strict';

const { DEFAULTS } = require('./defaults.js');

const PREFIX = 'APP_';

/**
 * Build the effective configuration. See docs/CONFIG.md.
 *
 * @param {object} fileConfig
 * @param {object} env
 * @returns {object}
 */
function loadConfig(fileConfig = {}, env = {}) {
  const config = { ...DEFAULTS, ...fileConfig };

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(PREFIX)) continue;
    const key = name.slice(PREFIX.length).toLowerCase();
    config[key] = value;
  }

  return config;
}

module.exports = { loadConfig };
