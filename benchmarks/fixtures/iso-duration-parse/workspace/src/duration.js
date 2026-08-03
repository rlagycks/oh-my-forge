'use strict';

/**
 * Convert an ISO 8601 duration to seconds.
 *
 * Only the time portion (hours, minutes, seconds) is supported so far.
 *
 * @param {string} input
 * @returns {number} Seconds.
 */
function parseDuration(input) {
  if (typeof input !== 'string') throw new TypeError('input must be a string');

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(input);
  if (!match) throw new Error('invalid duration');

  const [, hours, minutes, seconds] = match;
  if (hours === undefined && minutes === undefined && seconds === undefined) {
    throw new Error('invalid duration');
  }

  return Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0);
}

module.exports = { parseDuration };
