'use strict';

const REDACTED = '[REDACTED]';

/**
 * Scrub credentials from a log line before it is written.
 *
 * @param {string} line
 * @returns {string}
 */
function redactSecrets(line) {
  if (typeof line !== 'string') throw new TypeError('line must be a string');

  // Only the Bearer scheme is handled so far.
  return line.replace(/Authorization: Bearer \S+/g, `Authorization: Bearer ${REDACTED}`);
}

module.exports = { redactSecrets, REDACTED };
