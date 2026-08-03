'use strict';

/**
 * Intervals are half-open: [start, end).
 *
 * The start instant belongs to the interval; the end instant does not. This is
 * what lets a booking that ends at 10:00 sit next to one that starts at 10:00
 * without the two occupying the same instant.
 */

function assertInterval(interval, label) {
  if (!interval || typeof interval !== 'object') throw new TypeError(`${label} must be an object`);
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) {
    throw new TypeError(`${label} must have numeric start and end`);
  }
  if (interval.end < interval.start) throw new RangeError(`${label} must not end before it starts`);
}

/**
 * Is `instant` inside the half-open interval [start, end)?
 */
function contains(interval, instant) {
  assertInterval(interval, 'interval');
  if (!Number.isFinite(instant)) throw new TypeError('instant must be a number');
  return instant >= interval.start && instant < interval.end;
}

/**
 * Length of the half-open interval.
 */
function duration(interval) {
  assertInterval(interval, 'interval');
  return interval.end - interval.start;
}

/**
 * An interval covering no instants at all.
 */
function isEmpty(interval) {
  assertInterval(interval, 'interval');
  return interval.start === interval.end;
}

/**
 * Do two intervals share at least one instant?
 *
 * Half-open comparison: strict inequalities, so intervals that merely touch at
 * an endpoint do not overlap. An empty interval contains no instants and so
 * cannot overlap anything.
 */
function overlaps(a, b) {
  assertInterval(a, 'a');
  assertInterval(b, 'b');
  if (isEmpty(a) || isEmpty(b)) return false;
  return a.start < b.end && b.start < a.end;
}

module.exports = { contains, duration, isEmpty, overlaps };
