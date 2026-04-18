'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const sessionEndPath = path.join(repoRoot, 'scripts', 'hooks', 'session-end.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

function runSessionEnd(homeDir, transcriptPath, sessionId = 'trace000') {
  return spawnSync(process.execPath, [sessionEndPath], {
    cwd: repoRoot,
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CLAUDE_SESSION_ID: `session-${sessionId}`,
    },
  });
}

function readOnlySessionFile(homeDir) {
  const sessionsDir = path.join(homeDir, '.claude', 'session-data');
  const files = fs.readdirSync(sessionsDir).filter(file => file.endsWith('-session.tmp'));
  assert.strictEqual(files.length, 1, `expected one session file, got ${files.join(', ')}`);
  return fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
}

function readDecisionLog(homeDir) {
  const logFile = path.join(homeDir, '.claude', 'decisions', 'index.jsonl');
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

let passed = 0;
let failed = 0;

console.log('\nsession-end-failure-trace.test.js');

if (test('session-end captures failure trace signals from transcript text', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-failure-trace-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: 'user', content: 'Fix the handoff parser' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Command failed because RESULT was missing. Tests passed but evidence missing. Next suspicion: parseCodexResult fallback path.',
          },
        ],
      },
    }),
  ].join('\n'), 'utf8');

  try {
    const result = runSessionEnd(homeDir, transcriptPath);
    assert.strictEqual(result.status, 0, result.stderr);
    const content = readOnlySessionFile(homeDir);
    assert.ok(content.includes('### Failure Trace'), content);
    assert.ok(content.includes('Command failed because RESULT was missing'), content);
    assert.ok(content.includes('Tests passed but evidence missing'), content);
    assert.ok(content.includes('parseCodexResult fallback path'), content);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('session-end promotes concrete failure traces to durable decisions log', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-durable-trace-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: 'user', content: 'Fix durable trace promotion' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Command failed because durable log was empty. Tests passed but evidence missing. Next suspicion: failure trace promotion path.',
          },
        ],
      },
    }),
  ].join('\n'), 'utf8');

  try {
    const result = runSessionEnd(homeDir, transcriptPath, 'durable01');
    assert.strictEqual(result.status, 0, result.stderr);
    const entries = readDecisionLog(homeDir);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].domain, 'domain_session');
    assert.strictEqual(entries[0].type, 'failure-trace');
    assert.ok(entries[0].summary.includes('failure trace promotion path'), JSON.stringify(entries[0], null, 2));
    assert.ok(entries[0].why.includes('Command failed because durable log was empty'), JSON.stringify(entries[0], null, 2));
    assert.ok(!Object.prototype.hasOwnProperty.call(entries[0], 'evidence'), JSON.stringify(entries[0], null, 2));
    assert.deepStrictEqual(entries[0].falseNormalSignals, ['Tests passed but evidence missing.']);
    assert.deepStrictEqual(entries[0].verifyWith, ['Resolve missing evidence: Tests passed but evidence missing.']);
    assert.strictEqual(entries[0].nextSuspicion, 'failure trace promotion path');
    assert.ok(entries[0].ref.startsWith('failure-trace:'), entries[0].ref);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('session-end dedupes repeated durable failure trace promotions', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-durable-dedupe-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: 'user', content: 'Debug duplicate durable trace' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Command failed because duplicate promotion happened. Next suspicion: durable trace dedupe key.',
          },
        ],
      },
    }),
  ].join('\n'), 'utf8');

  try {
    const first = runSessionEnd(homeDir, transcriptPath, 'durable02');
    const second = runSessionEnd(homeDir, transcriptPath, 'durable02');

    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(second.status, 0, second.stderr);
    const entries = readDecisionLog(homeDir);
    assert.strictEqual(entries.length, 1, JSON.stringify(entries, null, 2));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('session-end does not promote blank failure trace templates', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-no-durable-trace-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'user', content: 'Only summarize normal work' }), 'utf8');

  try {
    const result = runSessionEnd(homeDir, transcriptPath, 'durable03');
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(readDecisionLog(homeDir), []);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('session-end keeps the latest next suspicion from the transcript', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-next-suspicion-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ type: 'user', content: 'Debug evolving failure traces' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Next suspicion: initial parser mismatch. Command failed because the schema rejected the result.',
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Initial suspicion disproven. Next suspicion: latest ontology profile drift. Next suspicion: final handoff template drift.',
          },
        ],
      },
    }),
  ].join('\n'), 'utf8');

  try {
    const result = runSessionEnd(homeDir, transcriptPath, 'trace002');
    assert.strictEqual(result.status, 0, result.stderr);
    const content = readOnlySessionFile(homeDir);
    assert.ok(content.includes('Next suspicion: final handoff template drift'), content);
    assert.ok(!content.includes('Next suspicion: initial parser mismatch'), content);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('session-end blank template asks for failure traces before tips', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-failure-template-'));
  const transcriptPath = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, '', 'utf8');

  try {
    const result = runSessionEnd(homeDir, transcriptPath, 'trace001');
    assert.strictEqual(result.status, 0, result.stderr);
    const content = readOnlySessionFile(homeDir);
    assert.ok(content.includes('### Failure Trace'), content);
    assert.ok(content.includes('Failed hypotheses'), content);
    assert.ok(content.includes('False-normal signals'), content);
    assert.ok(content.includes('Evidence still missing'), content);
    assert.ok(content.includes('Next suspicion'), content);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
