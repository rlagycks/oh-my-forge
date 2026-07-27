'use strict';

/**
 * Behavioral coverage for the advisory constraint guard. The hook must never
 * alter stdin or block a write, even when its local warning state is corrupt.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require(path.resolve(__dirname, '../../scripts/hooks/constraint-guard.js'));

let fixture = null;
let originalCwd = null;
let originalSessionId = null;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function makeFixture({ constraints, riskLevel = 'standard', index = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'constraint-guard-test-'));
  const filePath = path.join(root, 'src', 'guarded.js');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'module.exports = {};\n', 'utf8');
  if (index) {
    writeJson(path.join(root, '.claude', 'ontology', 'index.json'), {
      domain_guarded: {
        files: ['src/guarded.js'],
        constraints,
        riskLevel,
      },
    });
  }
  return { root, filePath };
}

function setup(options) {
  fixture = makeFixture(options);
  originalCwd = process.cwd();
  originalSessionId = process.env.CLAUDE_SESSION_ID;
  process.chdir(fixture.root);
  process.env.CLAUDE_SESSION_ID = `constraint-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanup() {
  if (originalCwd) process.chdir(originalCwd);
  if (originalSessionId === undefined) delete process.env.CLAUDE_SESSION_ID;
  else process.env.CLAUDE_SESSION_ID = originalSessionId;
  if (fixture) fs.rmSync(fixture.root, { recursive: true, force: true });
  fixture = null;
  originalCwd = null;
  originalSessionId = null;
}

function makeInput(toolName, toolInput = {}) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: fixture.filePath, ...toolInput },
  });
}

function captureStderr(fn) {
  const originalWrite = process.stderr.write.bind(process.stderr);
  let output = '';
  process.stderr.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    const result = fn();
    return { output, result };
  } finally {
    process.stderr.write = originalWrite;
  }
}

function guardStatePath() {
  return path.join(os.tmpdir(), `ecc-cguard-${process.env.CLAUDE_SESSION_ID}.json`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`  FAIL ${name}: ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;
console.log('\nconstraint-guard.test.js\n');

if (test('passes through malformed, untracked, and contentless hook payloads', () => {
  setup({ constraints: ['No fetch|pattern:fetch'] });
  try {
    assert.strictEqual(run('not json'), 'not json');
    assert.strictEqual(run(JSON.stringify({ tool_name: 'Edit', tool_input: {} })), JSON.stringify({ tool_name: 'Edit', tool_input: {} }));
    const untracked = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(fixture.root, 'src', 'other.js'), new_string: 'fetch()' } });
    assert.strictEqual(run(untracked), untracked);
    const contentless = makeInput('Edit');
    assert.strictEqual(run(contentless), contentless);
  } finally {
    cleanup();
  }
})) passed++; else failed++;

if (test('passes through projects without a usable ontology or constraints', () => {
  setup({ constraints: ['No fetch|pattern:fetch'], index: false });
  try {
    const withoutOntology = makeInput('Write', { content: 'fetch()' });
    assert.strictEqual(run(withoutOntology), withoutOntology);
  } finally {
    cleanup();
  }

  setup({ constraints: [] });
  try {
    const withoutConstraints = makeInput('Write', { content: 'fetch()' });
    assert.strictEqual(run(withoutConstraints), withoutConstraints);
  } finally {
    cleanup();
  }
})) passed++; else failed++;

if (test('ignores human-only constraints and nonmatching content', () => {
  setup({ constraints: ['Explain the intent in the PR', 'No fetch|pattern:fetch'] });
  try {
    const raw = makeInput('Write', { content: 'const client = createClient();' });
    const { output, result } = captureStderr(() => run(raw));
    assert.strictEqual(result, raw);
    assert.strictEqual(output, '');
  } finally {
    cleanup();
  }
})) passed++; else failed++;

if (test('warns case-insensitively for a standard-risk Edit and deduplicates the session', () => {
  setup({ constraints: ['Do not fetch|pattern:fetch|pattern:axios'] });
  try {
    const raw = makeInput('Edit', { new_string: 'return FETCH(url);' });
    const first = captureStderr(() => run(raw));
    assert.strictEqual(first.result, raw, 'advisory hook must pass through stdin unchanged');
    assert.match(first.output, /\[CONSTRAINT GUARD\] domain_guarded/);
    assert.match(first.output, /Matched pattern: "fetch"/);
    assert.match(first.output, /If this was intentional/);

    const second = captureStderr(() => run(raw));
    assert.strictEqual(second.result, raw);
    assert.strictEqual(second.output, '', 'the same constraint should warn once per session');
  } finally {
    cleanup();
  }
})) passed++; else failed++;

if (test('collects MultiEdit violations and gives high-risk guidance', () => {
  setup({
    riskLevel: 'high',
    constraints: [
      'No network calls|pattern:fetch',
      'No shelling out|pattern:child_process',
    ],
  });
  try {
    const raw = makeInput('MultiEdit', {
      edits: [
        { new_string: 'const cp = require("child_process");' },
        { new_string: 'return fetch(url);' },
      ],
    });
    const { output, result } = captureStderr(() => run(raw));
    assert.strictEqual(result, raw);
    assert.match(output, /WARNING: HIGH RISK/);
    assert.match(output, /No network calls/);
    assert.match(output, /No shelling out/);
    assert.match(output, /Review constraints in \.claude\/ontology\/index\.json/);
  } finally {
    cleanup();
  }
})) passed++; else failed++;

if (test('recovers from corrupt warning state without blocking a valid Write', () => {
  setup({ constraints: ['No eval|pattern:eval('] });
  try {
    fs.writeFileSync(guardStatePath(), '{not-json', 'utf8');
    const raw = makeInput('Write', { content: 'eval(input);' });
    const { output, result } = captureStderr(() => run(raw));
    assert.strictEqual(result, raw);
    assert.match(output, /CONSTRAINT VIOLATED: No eval/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(guardStatePath(), 'utf8')), ['domain_guarded::No eval']);
  } finally {
    cleanup();
  }
})) passed++; else failed++;

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
