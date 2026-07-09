#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024;
let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

/**
 * Extract command output text from a PostToolUse payload.
 * Real Bash tool_response shape: { stdout, stderr, interrupted, isImage }.
 * Legacy shapes (tool_response.output, tool_output.output, plain strings)
 * are kept as harmless fallbacks in case payloads vary across CC versions.
 */
function extractOutputText(input) {
  const resp = input.tool_response;
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object') {
    const parts = [resp.stdout, resp.stderr, resp.output]
      .filter(part => typeof part === 'string' && part);
    if (parts.length > 0) return parts.join('\n');
  }
  const legacy = input.tool_output;
  if (typeof legacy === 'string') return legacy;
  if (legacy && typeof legacy === 'object' && typeof legacy.output === 'string') {
    return legacy.output;
  }
  return '';
}

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cmd = String(input.tool_input?.command || '');

    if (/\bgh\s+pr\s+create\b/.test(cmd)) {
      const out = extractOutputText(input);
      const match = out.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
      if (match) {
        const prUrl = match[0];
        const repo = prUrl.replace(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/, '$1');
        const prNum = prUrl.replace(/.+\/pull\/(\d+)/, '$1');
        console.error(`[Hook] PR created: ${prUrl}`);
        console.error(`[Hook] To review: gh pr review ${prNum} --repo ${repo}`);
      }
    }
  } catch {
    // ignore parse errors and pass through
  }

  process.stdout.write(raw);
});
