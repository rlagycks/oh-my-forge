'use strict';

const fs = require('fs');
const path = require('path');
const { ALLOWED_PROVIDERS } = require('../ontology-maintainer-protocol');
const { CLAUDE_CODE_PROVIDER } = require('./claude-code');
const { CODEX_CLI_PROVIDER } = require('./codex-cli');

const PROVIDERS = Object.freeze({
  claude_code: CLAUDE_CODE_PROVIDER,
  codex_cli: CODEX_CLI_PROVIDER,
});

function getOntologyMaintainerProvider(provider) {
  if (!ALLOWED_PROVIDERS.includes(provider) || !Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) {
    throw new Error('Ontology maintainer provider must be explicitly allowed');
  }
  return PROVIDERS[provider];
}

function isTrustedExecutable(stat, getUid) {
  if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) return false;
  if (!Number.isSafeInteger(stat.mode) || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) return false;
  if (!Number.isSafeInteger(stat.uid)) return false;
  const currentUid = typeof getUid === 'function' ? getUid() : null;
  return stat.uid === 0 || (Number.isSafeInteger(currentUid) && stat.uid === currentUid);
}

function resolveOntologyMaintainerProviderBinary(provider, capabilities = {}, {
  fileSystem = fs,
  getUid = typeof process.getuid === 'function' ? () => process.getuid() : undefined,
} = {}) {
  getOntologyMaintainerProvider(provider);
  const configured = capabilities && capabilities[provider];
  if (!configured || typeof configured.binaryPath !== 'string' || !path.isAbsolute(configured.binaryPath)) return null;
  try {
    const realpath = typeof fileSystem.realpathSync?.native === 'function'
      ? fileSystem.realpathSync.native(configured.binaryPath)
      : fileSystem.realpathSync(configured.binaryPath);
    if (!path.isAbsolute(realpath) || !isTrustedExecutable(fileSystem.statSync(realpath), getUid)) return null;
    return realpath;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  PROVIDERS,
  getOntologyMaintainerProvider,
  isTrustedExecutable,
  resolveOntologyMaintainerProviderBinary,
};
