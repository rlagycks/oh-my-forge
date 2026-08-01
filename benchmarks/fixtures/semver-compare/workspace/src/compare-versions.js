'use strict';

/**
 * Compare two semantic versions.
 *
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new TypeError('versions must be strings');
  }

  const left = a.split('.');
  const right = b.split('.');

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] || '';
    const r = right[index] || '';
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return 0;
}

module.exports = { compareVersions };
