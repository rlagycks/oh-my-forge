#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isHookEnabled } = require('../lib/hook-flags');

function getPluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

function resolveRequestFile(pluginRoot, requestFile) {
  if (!requestFile || typeof requestFile !== 'string') return null;
  const trimmed = requestFile.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(pluginRoot, trimmed);
}

function loadRequestFile(requestFilePath) {
  try {
    return JSON.parse(fs.readFileSync(requestFilePath, 'utf8'));
  } catch (error) {
    return { error: `Failed to read request file: ${error.message}` };
  }
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
  const requestFilePath = resolveRequestFile(pluginRoot, parsed.requestFile);
  const requestPayload = requestFilePath ? loadRequestFile(requestFilePath) : { error: 'Missing request file path.' };
  if (requestPayload && requestPayload.error) {
    process.stdout.write('yes');
    process.exit(0);
  }
  if (requestPayload && Object.prototype.hasOwnProperty.call(requestPayload, 'profiles')) {
    profilesCsv = requestPayload.profiles;
  }
}

process.stdout.write(isHookEnabled(hookId, { profiles: profilesCsv }) ? 'yes' : 'no');
