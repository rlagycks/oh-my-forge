'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const sessionStartPath = path.resolve(__dirname, '../../scripts/hooks/session-start.js');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeInstinct(filePath, frontmatterLines, body = '') {
  mkdirp(path.dirname(filePath));
  const content = ['---', ...frontmatterLines, '---', body].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;
function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

console.log('\n=== Testing session-start hook ===\n');

// ---------------------------------------------------------------------------
// Unit tests — pure helper functions (safe to require() directly since main()
// is now gated behind `if (require.main === module)`)
//
// Instinct-loading helpers moved to scripts/lib/instinct-loader.js; their
// unit tests live in tests/lib/instinct-loader.test.js.
// ---------------------------------------------------------------------------

const {
  resolveSessionKey,
  getMarkerPath,
  isDuplicateInvocation,
  markEmitted,
} = require(sessionStartPath);

run('resolveSessionKey: uses session_id when present', () => {
  const key = resolveSessionKey({ session_id: 'abc-123' });
  assert.strictEqual(key, 'abc-123');
});

run('resolveSessionKey: falls back to a cwd hash when session_id is absent', () => {
  const key = resolveSessionKey({});
  assert.match(key, /^[a-f0-9]{16}$/);
  // Deterministic for the same cwd
  assert.strictEqual(key, resolveSessionKey({ session_id: '' }));
});

run('isDuplicateInvocation: true for a fresh marker, false once past the TTL', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-marker-'));
  const markerPath = path.join(tmpRoot, 'session-start-emitted-test');

  try {
    assert.strictEqual(isDuplicateInvocation(markerPath), false, 'missing marker is not a duplicate');

    markEmitted(markerPath);
    assert.strictEqual(isDuplicateInvocation(markerPath), true, 'fresh marker should be a duplicate');

    // Backdate the marker beyond a 60s TTL
    const past = (Date.now() - 120_000) / 1000;
    fs.utimesSync(markerPath, past, past);
    assert.strictEqual(isDuplicateInvocation(markerPath), false, 'marker older than TTL should not be a duplicate');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

run('getMarkerPath: keys under ~/.claude/tmp/session-start-emitted-<key>', () => {
  const markerPath = getMarkerPath('my-key');
  assert.ok(markerPath.includes(path.join('.claude', 'tmp')), markerPath);
  assert.ok(markerPath.endsWith('session-start-emitted-my-key'), markerPath);
});

// ---------------------------------------------------------------------------
// Integration tests — spawn the real hook script end-to-end
// ---------------------------------------------------------------------------

function runHook({ home, cwd, sessionId, source }) {
  return spawnSync(process.execPath, [sessionStartPath], {
    input: JSON.stringify({ session_id: sessionId, hook_event_name: 'SessionStart', source }),
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    timeout: 10_000,
  });
}

function writeDecisionsLog(home, entries) {
  const decisionsDir = path.join(home, '.claude', 'decisions');
  mkdirp(decisionsDir);
  const lines = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(path.join(decisionsDir, 'index.jsonl'), lines, 'utf8');
}

function parseAdditionalContext(stdout) {
  const payload = JSON.parse(stdout);
  return payload.hookSpecificOutput.additionalContext;
}

run('main(): duplicate invocation within the TTL emits empty additionalContext and logs the skip', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-project-'));

  try {
    // Seed a high-confidence global instinct so the first invocation is guaranteed
    // to produce non-empty additionalContext (deterministic assertion target).
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'demo.yaml'),
      ['id: demo-instinct', 'trigger: "when testing session-start"', 'confidence: 0.9', 'outcome: failure']
    );

    const first = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'dup-session-1' });
    assert.strictEqual(first.status, 0, first.stderr);
    const firstContext = parseAdditionalContext(first.stdout);
    assert.ok(firstContext.includes('Learned instincts'), firstContext);

    const markerPath = path.join(tmpHome, '.claude', 'tmp', 'session-start-emitted-dup-session-1');
    assert.ok(fs.existsSync(markerPath), 'marker file should exist after first emission');

    const second = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'dup-session-1' });
    assert.strictEqual(second.status, 0, second.stderr);
    const secondContext = parseAdditionalContext(second.stdout);
    assert.strictEqual(secondContext, '', 'second invocation within the TTL should emit empty additionalContext');
    assert.ok(
      second.stderr.includes('[SessionStart] duplicate invocation detected — skipping context injection'),
      second.stderr
    );
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

run('main(): a different session_id is not treated as a duplicate', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-project-'));

  try {
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'demo.yaml'),
      ['id: demo-instinct', 'trigger: "when testing session-start"', 'confidence: 0.9', 'outcome: failure']
    );

    runHook({ home: tmpHome, cwd: projectDir, sessionId: 'session-a' });
    const other = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'session-b' });
    assert.strictEqual(other.status, 0, other.stderr);
    const otherContext = parseAdditionalContext(other.stdout);
    assert.ok(otherContext.includes('Learned instincts'), otherContext);
    assert.ok(!other.stderr.includes('duplicate invocation detected'), other.stderr);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

run('main(): low-confidence instincts are not injected', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-e2e-project-'));

  try {
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'weak.yaml'),
      ['id: weak-instinct', 'trigger: "rarely useful"', 'confidence: 0.4']
    );

    const result = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'low-confidence-session' });
    assert.strictEqual(result.status, 0, result.stderr);
    const context = parseAdditionalContext(result.stdout);
    assert.ok(!context.includes('Learned instincts'), context);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

run('main(): source=compact includes the continuity packet in additionalContext and emits valid JSON', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-continuity-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-continuity-project-'));

  try {
    writeDecisionsLog(tmpHome, [{
      id: 'd1',
      date: '2026-01-01',
      type: 'fix',
      domain: 'domain_x',
      summary: 'Fixed the widget',
      why: 'root cause was X',
      project: path.basename(projectDir),
    }]);

    const result = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'continuity-compact', source: 'compact' });
    assert.strictEqual(result.status, 0, result.stderr);

    const context = parseAdditionalContext(result.stdout);
    assert.ok(context.includes('Recent decisions (why)'), context);
    assert.ok(context.includes('Fixed the widget'), context);
    assert.ok(result.stderr.includes('[SessionStart] Continuity packet injected'), result.stderr);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

run('main(): with no decisions log, additionalContext has no continuity packet and JSON is still valid', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-nocontinuity-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-nocontinuity-project-'));

  try {
    const result = runHook({ home: tmpHome, cwd: projectDir, sessionId: 'no-continuity', source: 'startup' });
    assert.strictEqual(result.status, 0, result.stderr);

    const context = parseAdditionalContext(result.stdout);
    assert.ok(!context.includes('Recent decisions (why)'), context);
    assert.ok(!result.stderr.includes('[SessionStart] Continuity packet injected'), result.stderr);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
