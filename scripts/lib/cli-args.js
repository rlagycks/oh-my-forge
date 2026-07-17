'use strict';

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseInteger(value, flag, { minimum, maximum } = {}) {
  const parsed = Number(value);
  const belowMinimum = minimum !== undefined && parsed < minimum;
  const aboveMaximum = maximum !== undefined && parsed > maximum;
  if (!Number.isInteger(parsed) || belowMinimum || aboveMaximum) {
    throw new Error(`${flag} must be an integer${minimum !== undefined ? ` >= ${minimum}` : ''}${maximum !== undefined ? ` <= ${maximum}` : ''}`);
  }
  return parsed;
}

module.exports = { parseInteger, requireValue };
