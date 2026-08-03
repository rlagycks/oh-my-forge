'use strict';

// Keys that can reach Object.prototype and affect unrelated objects.
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return [...value];
  if (isPlainObject(value)) return mergeInto({}, value);
  return value;
}

function mergeInto(accumulator, source) {
  return Object.keys(source).reduce((result, key) => {
    if (BLOCKED_KEYS.has(key)) return result;

    const value = source[key];
    if (value === undefined) return result;

    if (isPlainObject(value) && isPlainObject(result[key])) {
      return { ...result, [key]: mergeInto({ ...result[key] }, value) };
    }
    return { ...result, [key]: cloneValue(value) };
  }, accumulator);
}

/**
 * Recursively merge source into a new object, leaving both inputs untouched.
 *
 * Keys that can reach Object.prototype are skipped at every depth.
 *
 * @returns {object} A new merged object.
 */
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    throw new TypeError('deepMerge expects two plain objects');
  }

  // Deep-copy the target first so nested target objects are not shared with the
  // returned value, which would let a later write mutate the caller's input.
  const base = Object.keys(target).reduce((result, key) => (
    BLOCKED_KEYS.has(key) ? result : { ...result, [key]: cloneValue(target[key]) }
  ), {});

  return mergeInto(base, source);
}

module.exports = { deepMerge };
