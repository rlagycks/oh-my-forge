'use strict';

/**
 * Delay before the next retry.
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

  // Linear growth, and jitter is applied before the cap.
  const delay = baseDelayMs * (attempt + 1) * random();
  return Math.min(delay, maxDelayMs);
}

module.exports = { computeDelay };
