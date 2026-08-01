'use strict';

/**
 * Delay before the next retry.
 *
 * Exponential growth, capped, then jittered by a factor in [0.5, 1.0).
 *
 * @param {number} attempt      Zero-based attempt index.
 * @param {object} options
 * @param {number} options.baseDelayMs
 * @param {number} options.maxDelayMs
 * @param {function} options.random  Returns a float in [0, 1).
 * @returns {number} Milliseconds to wait.
 */
function computeDelay(attempt, { baseDelayMs, maxDelayMs, random }) {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError('attempt must be a non-negative integer');
  }

  // Cap the exponential term before jitter so the cap bounds the growth curve
  // rather than the random draw.
  const exponential = Math.min(baseDelayMs * (2 ** attempt), maxDelayMs);
  return Math.floor(exponential * (0.5 + 0.5 * random()));
}

module.exports = { computeDelay };
