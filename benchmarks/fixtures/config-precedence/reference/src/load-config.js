'use strict';

const { DEFAULTS } = require('./defaults.js');

const PREFIX = 'APP_';
const NESTING_SEPARATOR = '__';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDeep(value) {
  if (Array.isArray(value)) return value.map(cloneDeep);
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((acc, [key, item]) => ({ ...acc, [key]: cloneDeep(item) }), {});
  }
  return value;
}

/**
 * Deep merge with array replacement, per docs/CONFIG.md.
 */
function mergeDeep(base, overlay) {
  return Object.entries(overlay).reduce((result, [key, value]) => {
    if (value === undefined) return result;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      return { ...result, [key]: mergeDeep(result[key], value) };
    }
    // Arrays replace rather than concatenate, so a file can shorten a list.
    return { ...result, [key]: cloneDeep(value) };
  }, base);
}

function pathFromVariable(name) {
  return name.slice(PREFIX.length).toLowerCase().split(NESTING_SEPARATOR.toLowerCase());
}

function readPath(target, segments) {
  return segments.reduce(
    (current, segment) => (isPlainObject(current) ? current[segment] : undefined),
    target
  );
}

function writePath(target, segments, value) {
  const [head, ...rest] = segments;
  if (rest.length === 0) return { ...target, [head]: value };
  return { ...target, [head]: writePath(isPlainObject(target[head]) ? target[head] : {}, rest, value) };
}

/**
 * Coerce an environment string to the type of the value it overrides.
 * Returns undefined when the value should be ignored.
 */
function coerce(raw, existing) {
  if (typeof existing === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof existing === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return undefined;
  }
  return raw;
}

/**
 * Build the effective configuration. See docs/CONFIG.md.
 *
 * Layers, later winning: defaults, file, environment.
 *
 * @param {object} fileConfig
 * @param {object} env
 * @returns {object}
 */
function loadConfig(fileConfig = {}, env = {}) {
  // Clone the defaults so the exported object is never mutated for later callers.
  const merged = mergeDeep(cloneDeep(DEFAULTS), fileConfig);

  return Object.entries(env).reduce((config, [name, raw]) => {
    if (!name.startsWith(PREFIX)) return config;
    // Unset and empty variables fall back to the file or defaults.
    if (raw === undefined || raw === null || raw === '') return config;

    const segments = pathFromVariable(name);
    const existing = readPath(config, segments);
    // Only keys that already exist may be set from the environment.
    if (existing === undefined) return config;

    const value = coerce(raw, existing);
    if (value === undefined) return config;

    return writePath(config, segments, value);
  }, merged);
}

module.exports = { loadConfig };
