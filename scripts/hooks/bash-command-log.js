#!/usr/bin/env node
/**
 * Optional Bash command audit hook.
 *
 * Disabled by default. When enabled, writes a redacted command summary to
 * ~/.claude/logs/bash-commands.jsonl without storing the raw full command line.
 */

'use strict';

const path = require('path');
const {
  appendFile,
  getClaudeDir,
} = require('../lib/utils');

const ENABLE_ENV = 'ECC_ENABLE_BASH_COMMAND_LOG';
const MAX_STDIN = 1024 * 1024;
const MAX_PREVIEW_CHARS = 160;

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|COOKIE|AUTH|URL|CONNECTION_STRING))=(?:"[^"]*"|'[^']*'|\S+)/g, '$1=<REDACTED>')
    .replace(/(--(?:api-key|token|password|secret|cookie|authorization|header))(?:(=)|\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, (_match, flag, equals) => `${flag}${equals || ' '}<REDACTED>`)
    .replace(/\b(Authorization:)\s*(?:Bearer|Basic)\s+(?:"[^"]*"|'[^']*'|\S+)/gi, '$1 <REDACTED>')
    .replace(/\b((?:Cookie|Set-Cookie):)\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '$1 <REDACTED>')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\b/g, '$1 <REDACTED>')
    .replace(/([?&](?:token|key|api_key|apikey|password|secret)=)[^&\s]+/gi, '$1<REDACTED>')
    .replace(/\b(?:gh[pous]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '<REDACTED>')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<REDACTED>');
}

function summarizeCommand(command) {
  const preview = collapseWhitespace(redactSecrets(command));
  const tokens = preview.split(' ').filter(Boolean);

  let offset = 0;
  while (offset < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[offset])) {
    offset += 1;
  }

  const firstToken = tokens[offset] || '?';
  const secondToken = tokens[offset + 1] || '';
  const commandFamily = firstToken === 'sudo' && secondToken ? `sudo ${secondToken}` : firstToken;

  return {
    commandFamily,
    hasElevatedPrivileges: firstToken === 'sudo',
    preview: preview.length > MAX_PREVIEW_CHARS
      ? `${preview.slice(0, MAX_PREVIEW_CHARS - 3)}...`
      : preview,
  };
}

function buildAuditRow(input) {
  const command = String(input.tool_input?.command || '');
  const summary = summarizeCommand(command);

  return {
    timestamp: new Date().toISOString(),
    session_id: String(process.env.CLAUDE_SESSION_ID || 'default'),
    tool_name: String(input.tool_name || 'Bash'),
    command_family: summary.commandFamily,
    has_elevated_privileges: summary.hasElevatedPrivileges,
    redacted_preview: summary.preview,
  };
}

function run(rawInput) {
  if (!isEnabled(process.env[ENABLE_ENV])) {
    return rawInput;
  }

  try {
    const input = rawInput.trim() ? JSON.parse(rawInput) : {};
    if (String(input.tool_name || '') !== 'Bash') {
      return rawInput;
    }

    const row = buildAuditRow(input);
    appendFile(path.join(getClaudeDir(), 'logs', 'bash-commands.jsonl'), `${JSON.stringify(row)}\n`);
  } catch {
    // Never block the tool pipeline on audit logging.
  }

  return rawInput;
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(raw));
  });
}

module.exports = {
  buildAuditRow,
  redactSecrets,
  run,
  summarizeCommand,
};
