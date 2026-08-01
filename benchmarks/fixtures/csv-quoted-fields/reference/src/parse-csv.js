'use strict';

/**
 * Parse CSV text into an array of rows, where each row is an array of fields.
 *
 * Follows RFC 4180: a field may be wrapped in double quotes, in which case it
 * may contain commas, newlines, and escaped double quotes ("" for one literal
 * quote). Surrounding quotes are stripped from the parsed value.
 */
function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (text === '') return [];

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // A double quote only opens a quoted field at the start of a field. Anywhere
  // else it is a literal character, matching how Python's csv module treats
  // malformed input such as `a"b`.
  let atFieldStart = true;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (char === ',') {
      row.push(field);
      field = '';
      atFieldStart = true;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
    } else {
      field += char;
      atFieldStart = false;
    }
  }

  // A trailing newline terminates the final row rather than starting a new one.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

module.exports = { parseCsv };
