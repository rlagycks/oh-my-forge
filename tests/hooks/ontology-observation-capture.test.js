'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  captureObservations,
  run,
} = require('../../scripts/hooks/ontology-observation-capture');

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

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-observation-'));
  const sourceDir = path.join(root, 'src');
  const filePath = path.join(sourceDir, 'example.js');
  fs.mkdirSync(path.join(root, '.claude', 'ontology'), { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(filePath, 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, '.claude', 'ontology', 'index.json'), JSON.stringify({
    domain_example: {
      summary: 'example',
      files: ['src/'],
      spec: 'docs/features/example.md',
      owner: 'test',
    },
  }), 'utf8');
  return { root, filePath, logPath: path.join(root, 'observations.jsonl') };
}

let passed = 0;
let failed = 0;

console.log('\nontology-observation-capture.test.js');

if (test('captures metadata-only observations for ontology-tracked edited files', () => {
  const fixture = makeFixture();
  try {
    const observations = captureObservations(JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: fixture.filePath, old_string: '1', new_string: '2' },
    }), {
      sessionId: 'session-1',
      cwd: fixture.root,
      logPath: fixture.logPath,
      now: '2026-07-25T00:00:00.000Z',
    });

    assert.strictEqual(observations.length, 1);
    assert.strictEqual(observations[0].domainKey, 'domain_example');
    assert.strictEqual(observations[0].filePath, 'src/example.js');
    assert.strictEqual(observations[0].contentFingerprint.length, 64);
    assert.ok(!JSON.stringify(observations[0]).includes('module.exports'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fixture.logPath, 'utf8')), observations[0]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) {
  passed++;
} else {
  failed++;
}

if (test('deduplicates an unchanged file within a session', () => {
  const fixture = makeFixture();
  try {
    const raw = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: fixture.filePath } });
    const options = { sessionId: 'session-1', cwd: fixture.root, logPath: fixture.logPath };
    assert.strictEqual(captureObservations(raw, options).length, 1);
    assert.strictEqual(captureObservations(raw, options).length, 0);
    assert.strictEqual(fs.readFileSync(fixture.logPath, 'utf8').trim().split('\n').length, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) {
  passed++;
} else {
  failed++;
}

if (test('does not persist source content or observations for untracked files', () => {
  const fixture = makeFixture();
  const untracked = path.join(fixture.root, 'README.md');
  fs.writeFileSync(untracked, 'do not persist this source content\n', 'utf8');
  try {
    const raw = JSON.stringify({ tool_name: 'Write', tool_input: { path: untracked, content: 'secret content' } });
    assert.deepStrictEqual(captureObservations(raw, { sessionId: 'session-1', cwd: fixture.root, logPath: fixture.logPath }), []);
    assert.ok(!fs.existsSync(fixture.logPath));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) {
  passed++;
} else {
  failed++;
}

if (test('always passes the hook input through when capture fails or is disabled', () => {
  const raw = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
  assert.strictEqual(run(raw, { cwd: os.tmpdir(), logPath: path.join(os.tmpdir(), 'missing', 'log') }), raw);
})) {
  passed++;
} else {
  failed++;
}

if (test('registers capture as an asynchronous PostToolUse edit hook', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
  const registration = hooks.hooks.PostToolUse.find(entry => entry.hooks?.some(hook =>
    String(hook.command || '').includes('ontology-observation-capture.js')));
  assert.ok(registration, 'missing ontology observation capture registration');
  assert.strictEqual(registration.matcher, 'Edit|Write|MultiEdit');
  assert.strictEqual(registration.hooks[0].async, true);
} )) {
  passed++;
} else {
  failed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
