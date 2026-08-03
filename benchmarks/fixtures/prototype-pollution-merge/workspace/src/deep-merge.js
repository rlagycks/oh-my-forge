'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merge source into target.
 *
 * @returns {object} The merged object.
 */
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    throw new TypeError('deepMerge expects two plain objects');
  }

  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value === undefined) continue;

    if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }

  return target;
}

module.exports = { deepMerge };
