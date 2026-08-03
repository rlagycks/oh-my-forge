'use strict';

/**
 * Parse a JSONL event log.
 *
 * @param {string} text  Raw log contents.
 * @returns {{events: object[], skipped: {corrupt: number, unrecognized: number}}}
 */
function readEvents(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');

  const events = [];
  const skipped = { corrupt: 0, unrecognized: 0 };

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    // A malformed line throws out of the whole read, and any record without a
    // schema_version is dropped without a trace.
    const record = JSON.parse(line);
    if (record.schema_version === undefined) continue;

    events.push(record);
  }

  return { events, skipped };
}

module.exports = { readEvents };
