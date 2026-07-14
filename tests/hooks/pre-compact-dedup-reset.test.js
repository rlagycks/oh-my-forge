'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const preCompactPath = path.resolve(__dirname, '../../scripts/hooks/pre-compact.js');
const {
  getStatePath,
  saveInjected,
} = require('../../scripts/lib/inject-dedup');

function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`  ✓ ${name}`);
      return true;
    })
    .catch(err => {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      return false;
    });
}

function createTestHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-compact-dedup-home-'));
}

function createSessionId(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function withSessionId(sessionId, fn) {
  const previous = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = sessionId;

  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = previous;
  }
}

function runPreCompact(home, sessionId) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [preCompactPath], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_SESSION_ID: sessionId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => (stdout += data));
    proc.stderr.on('data', data => (stderr += data));
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
    proc.stdin.end();
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('\n=== Testing pre-compact dedup reset ===\n');

  if (await test('clears existing domain-context-inject dedup state for the same session', async () => {
    const home = createTestHome();
    const sessionId = createSessionId('pre-compact-clears');
    let statePath;

    try {
      withSessionId(sessionId, () => {
        saveInjected(new Set(['domain_hooks']));
        statePath = getStatePath();
      });

      assert.ok(fs.existsSync(statePath), 'dedup state should exist before PreCompact runs');

      const result = await runPreCompact(home, sessionId);

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(!fs.existsSync(statePath), 'dedup state should be removed after PreCompact runs');
    } finally {
      if (statePath) fs.rmSync(statePath, { force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('exits 0 when no dedup state exists for the session', async () => {
    const home = createTestHome();
    const sessionId = createSessionId('pre-compact-missing');
    let statePath;

    try {
      statePath = withSessionId(sessionId, () => getStatePath());
      fs.rmSync(statePath, { force: true });

      const result = await runPreCompact(home, sessionId);

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(!fs.existsSync(statePath), 'dedup state should remain absent after PreCompact runs');
    } finally {
      if (statePath) fs.rmSync(statePath, { force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
