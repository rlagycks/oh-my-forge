'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');

const {
  buildAuditRow,
  redactSecrets,
  summarizeCommand,
} = require('../../scripts/hooks/bash-command-log');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\n=== bash-command-log ===\n');

if (test('redactSecrets strips common env assignments, flags, and auth headers', () => {
  const redacted = redactSecrets([
    'OPENAI_API_KEY=sk-live-secret',
    'curl https://example.test?token=abc123',
    '--api-key xyz',
    'Authorization: Bearer super-secret',
    'Cookie: session=top-secret',
  ].join(' '));

  assert.ok(!redacted.includes('sk-live-secret'), redacted);
  assert.ok(!redacted.includes('abc123'), redacted);
  assert.ok(!redacted.includes('xyz'), redacted);
  assert.ok(!redacted.includes('super-secret'), redacted);
  assert.ok(!redacted.includes('top-secret'), redacted);
  assert.ok(redacted.includes('OPENAI_API_KEY=<REDACTED>'), redacted);
})) passed++; else failed++;

if (test('summarizeCommand keeps only a short redacted preview and command family', () => {
  const summary = summarizeCommand('OPENAI_API_KEY=sk-live-secret sudo npm run deploy --token abc123');
  assert.strictEqual(summary.commandFamily, 'sudo npm');
  assert.strictEqual(summary.hasElevatedPrivileges, true);
  assert.ok(summary.preview.includes('<REDACTED>'), summary.preview);
  assert.ok(!summary.preview.includes('abc123'), summary.preview);
})) passed++; else failed++;

if (test('buildAuditRow emits structured metadata without raw secrets', () => {
  const sessionId = `bash-command-log-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.CLAUDE_SESSION_ID = sessionId;

  try {
    const row = buildAuditRow({
      tool_name: 'Bash',
      tool_input: {
        command: `DATABASE_URL=postgres://secret@localhost/app git push --force-with-lease ${path.join(os.tmpdir(), 'deploy.sh')}`,
      },
    });

    assert.strictEqual(row.session_id, sessionId);
    assert.strictEqual(row.tool_name, 'Bash');
    assert.strictEqual(row.command_family, 'git');
    assert.ok(row.redacted_preview.includes('DATABASE_URL=<REDACTED>'), row.redacted_preview);
    assert.ok(!row.redacted_preview.includes('postgres://secret'), row.redacted_preview);
    assert.ok(typeof row.timestamp === 'string' && row.timestamp.length > 0);
  } finally {
    delete process.env.CLAUDE_SESSION_ID;
  }
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
