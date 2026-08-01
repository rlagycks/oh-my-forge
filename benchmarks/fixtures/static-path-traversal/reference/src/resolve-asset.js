'use strict';

const path = require('node:path');

/**
 * Resolve a client-supplied request path against the static asset root.
 *
 * Any request that would resolve outside the root is rejected. Legitimate
 * nested paths continue to resolve normally.
 *
 * @param {string} root         Absolute path to the asset root.
 * @param {string} requestPath  Path taken from the incoming request.
 * @returns {string} Absolute path to the asset, guaranteed to be under root.
 */
function resolveAsset(root, requestPath) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new TypeError('root must be an absolute path');
  }
  if (typeof requestPath !== 'string') {
    throw new TypeError('requestPath must be a string');
  }

  // A NUL byte can truncate the path in downstream native calls.
  if (requestPath.includes('\0')) throw new Error('forbidden path');

  const trimmed = requestPath.replace(/^\/+/, '');
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, trimmed);

  // Compare against root + separator so a sibling directory sharing the root's
  // prefix (e.g. /srv/assets-evil) is not accepted as being inside /srv/assets.
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error('forbidden path');
  }

  return resolved;
}

module.exports = { resolveAsset };
