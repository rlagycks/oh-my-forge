'use strict';

const REDACTED = '[REDACTED]';

// Order matters: the JWT pattern is applied before the generic Authorization
// pattern would swallow it, and userinfo is handled on the URL form only.
const PATTERNS = [
  // Authorization header, both schemes, credential only.
  [/(Authorization: (?:Bearer|Basic) )\S+/g, `$1${REDACTED}`],
  // JWT: three base64url segments.
  [/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  // AWS access key id.
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  // URL userinfo password, username preserved.
  [/(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+(@)/g, `$1${REDACTED}$2`],
];

/**
 * Scrub credentials from a log line before it is written.
 *
 * @param {string} line
 * @returns {string}
 */
function redactSecrets(line) {
  if (typeof line !== 'string') throw new TypeError('line must be a string');

  return PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    line
  );
}

module.exports = { redactSecrets, REDACTED };
