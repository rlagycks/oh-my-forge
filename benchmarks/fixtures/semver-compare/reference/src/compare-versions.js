'use strict';

function parse(version) {
  // Build metadata never affects precedence, so it is discarded first.
  const withoutBuild = version.split('+')[0];
  const separator = withoutBuild.indexOf('-');
  const core = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prerelease = separator === -1 ? null : withoutBuild.slice(separator + 1);

  return {
    core: core.split('.').map(part => Number(part) || 0),
    prerelease: prerelease === null ? null : prerelease.split('.'),
  };
}

function compareNumbers(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function comparePrereleaseSegment(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);

  if (aNumeric && bNumeric) return compareNumbers(Number(a), Number(b));
  // Numeric identifiers always rank below non-numeric ones.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function comparePrerelease(a, b) {
  if (a === null && b === null) return 0;
  // A version without a prerelease outranks the same version with one.
  if (a === null) return 1;
  if (b === null) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (index >= a.length) return -1;
    if (index >= b.length) return 1;
    const result = comparePrereleaseSegment(a[index], b[index]);
    if (result !== 0) return result;
  }
  return 0;
}

/**
 * Compare two semantic versions.
 *
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new TypeError('versions must be strings');
  }

  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < Math.max(left.core.length, right.core.length); index += 1) {
    const result = compareNumbers(left.core[index] || 0, right.core[index] || 0);
    if (result !== 0) return result;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

module.exports = { compareVersions };
