'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Infer the event type of a pre-schema_version record from its shape.
 *
 * @returns {string|null} null when the record matches no known legacy shape.
 */
function inferLegacyType(record) {
  if (record.injected_tokens !== undefined) return 'injection';
  if (record.outcome !== undefined) return 'outcome';
  return null;
}

/**
 * Parse a JSONL event log.
 *
 * Legacy records written before schema_version existed are normalized rather
 * than dropped, and a single malformed line never aborts the read.
 *
 * @param {string} text  Raw log contents.
 * @returns {{events: object[], skipped: {corrupt: number, unrecognized: number}}}
 */
function readEvents(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');

  return text.split('\n').reduce((state, line) => {
    if (line.trim() === '') return state;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return { ...state, skipped: { ...state.skipped, corrupt: state.skipped.corrupt + 1 } };
    }

    if (!isPlainObject(record)) {
      return { ...state, skipped: { ...state.skipped, corrupt: state.skipped.corrupt + 1 } };
    }

    if (record.schema_version !== undefined) {
      return { ...state, events: [...state.events, record] };
    }

    const eventType = inferLegacyType(record);
    if (eventType === null) {
      return { ...state, skipped: { ...state.skipped, unrecognized: state.skipped.unrecognized + 1 } };
    }

    return {
      ...state,
      events: [...state.events, { ...record, schema_version: 0, event_type: eventType }],
    };
  }, { events: [], skipped: { corrupt: 0, unrecognized: 0 } });
}

module.exports = { readEvents };
