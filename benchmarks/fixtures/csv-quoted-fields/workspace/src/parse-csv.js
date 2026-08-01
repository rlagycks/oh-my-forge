'use strict';

/**
 * Parse CSV text into an array of rows, where each row is an array of fields.
 *
 * Intended to follow RFC 4180.
 */
function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (text === '') return [];

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;

  return withoutTrailingNewline
    .split('\n')
    .map(line => line.split(','));
}

module.exports = { parseCsv };
