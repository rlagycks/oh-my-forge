'use strict';

const path = require('node:path');

/**
 * Resolve a client-supplied request path against the static asset root.
 *
 * @param {string} root         Absolute path to the asset root.
 * @param {string} requestPath  Path taken from the incoming request.
 * @returns {string} Absolute path to the asset.
 */
function resolveAsset(root, requestPath) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new TypeError('root must be an absolute path');
  }
  if (typeof requestPath !== 'string') {
    throw new TypeError('requestPath must be a string');
  }

  const trimmed = requestPath.replace(/^\/+/, '');
  return path.join(root, trimmed);
}

module.exports = { resolveAsset };
