'use strict';

const fs = require('fs');
const path = require('path');

function resolveRequestFilePath(pluginRoot, requestFile) {
  if (!requestFile || typeof requestFile !== 'string') return null;
  const trimmed = requestFile.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(pluginRoot, trimmed);
}

function loadJsonFile(filePath, label = 'request file') {
  try {
    return { payload: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { payload: null, error: `Failed to read ${label}: ${error.message}` };
  }
}

module.exports = {
  resolveRequestFilePath,
  loadJsonFile,
};

