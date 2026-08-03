'use strict';

const SECONDS = {
  years: 31536000,
  months: 2592000,
  weeks: 604800,
  days: 86400,
  hours: 3600,
  minutes: 60,
  seconds: 1,
};

// M before T is months; M after T is minutes. Seconds may be fractional with
// either a dot or a comma as the decimal separator.
const PATTERN = new RegExp(
  '^(-)?P'
  + '(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?'
  + '(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+(?:[.,]\\d+)?)S)?)?$'
);

/**
 * Convert an ISO 8601 duration to seconds.
 *
 * Years and months use fixed conversions rather than calendar arithmetic.
 *
 * @param {string} input
 * @returns {number} Seconds, rounded to three decimal places.
 */
function parseDuration(input) {
  if (typeof input !== 'string') throw new TypeError('input must be a string');

  const match = PATTERN.exec(input);
  if (!match) throw new Error('invalid duration');

  const [, sign, years, months, weeks, days, hours, minutes, seconds] = match;
  const components = [years, months, weeks, days, hours, minutes, seconds];

  // "P" or "PT" alone carries no duration.
  if (components.every(component => component === undefined)) throw new Error('invalid duration');

  // A T separator must be followed by at least one time component.
  const hasT = input.includes('T');
  const hasTimeComponent = hours !== undefined || minutes !== undefined || seconds !== undefined;
  if (hasT && !hasTimeComponent) throw new Error('invalid duration');

  const total = Number(years || 0) * SECONDS.years
    + Number(months || 0) * SECONDS.months
    + Number(weeks || 0) * SECONDS.weeks
    + Number(days || 0) * SECONDS.days
    + Number(hours || 0) * SECONDS.hours
    + Number(minutes || 0) * SECONDS.minutes
    + Number(String(seconds || 0).replace(',', '.'));

  const rounded = Math.round(total * 1000) / 1000;
  const signed = sign === '-' ? -rounded : rounded;
  // Normalize -0, which strict equality treats as distinct from 0.
  return signed === 0 ? 0 : signed;
}

module.exports = { parseDuration };
