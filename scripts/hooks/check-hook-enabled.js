#!/usr/bin/env node
'use strict';

const path = require('path');
const { isHookEnabled } = require('../lib/hook-flags');
const { resolveRequestFilePath, loadJsonFile } = require('../lib/request-file');

function getPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const hookId = args.shift() || '';

  let legacyProfilesCsv = null;
  let profilesCsv = null;
  let requestFile = null;

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === '--profiles') {
      profilesCsv = args[i + 1] || null;
      i++;
      continue;
    }
    if (tok === '--request-file') {
      requestFile = args[i + 1] || null;
      i++;
      continue;
    }

    if (!tok.startsWith('--') && legacyProfilesCsv === null) {
      legacyProfilesCsv = tok;
      continue;
    }
  }

  return {
    hookId,
    profilesCsv: profilesCsv ?? legacyProfilesCsv,
    requestFile,
  };
}

const parsed = parseArgs(process.argv.slice(2));
const hookId = parsed.hookId;
if (!hookId) {
  process.stdout.write('yes');
  process.exit(0);
}

let profilesCsv = parsed.profilesCsv;
if (parsed.requestFile) {
  const pluginRoot = getPluginRoot();
  const requestFilePath = resolveRequestFilePath(pluginRoot, parsed.requestFile);
  const requestFile = requestFilePath
    ? loadJsonFile(requestFilePath, 'request file')
    : { payload: null, error: 'Missing request file path.' };

  if (requestFile && requestFile.error) {
    process.stdout.write('no');
    process.exit(0);
  }

  if (requestFile.payload && Object.prototype.hasOwnProperty.call(requestFile.payload, 'profiles')) {
    profilesCsv = requestFile.payload.profiles;
  }
}

process.stdout.write(isHookEnabled(hookId, { profiles: profilesCsv }) ? 'yes' : 'no');
