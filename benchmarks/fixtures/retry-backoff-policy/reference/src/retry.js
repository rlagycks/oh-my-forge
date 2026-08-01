'use strict';

const { computeDelay } = require('./backoff.js');

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  maxElapsedMs: 30000,
  isRetryable: () => true,
};

/**
 * Run an operation with exponential backoff.
 *
 * @param {function} operation  Async function to run.
 * @param {object} options
 * @param {object} deps  { now, random, sleep }
 */
async function retry(operation, options = {}, deps = {}) {
  const config = { ...DEFAULTS, ...options };
  const { now, random, sleep } = deps;
  const startedAt = now();

  let lastError;
  // maxAttempts counts total attempts, including the first.
  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      // A non-retryable error must surface immediately, without a sleep.
      if (!config.isRetryable(error)) throw error;

      const isLastAttempt = attempt === config.maxAttempts - 1;
      if (isLastAttempt) break;

      const delay = computeDelay(attempt, { ...config, random });
      // Stop if waiting would push us past the elapsed-time budget.
      if (now() - startedAt + delay > config.maxElapsedMs) break;

      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = { retry, DEFAULTS };
