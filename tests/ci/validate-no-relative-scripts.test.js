'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts/ci/validate-no-relative-scripts.js');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const AGENTS_DIR = path.join(ROOT, 'agents');
const SKILLS_DIR = path.join(ROOT, 'skills');
const TMP_DIR_NAME = '.tmp-validate-no-relative-scripts';

function cleanupTmpDirs() {
  for (const dir of [COMMANDS_DIR, AGENTS_DIR, SKILLS_DIR]) {
    const tmpPath = path.join(dir, TMP_DIR_NAME);
    fs.rmSync(tmpPath, { recursive: true, force: true });
  }
}

function writeFixture(baseDir, filename, content) {
  const dir = path.join(baseDir, TMP_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function runValidator() {
  return spawnSync(process.execPath, [VALIDATOR], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function test(name, fn) {
  try {
    cleanupTmpDirs();
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  } finally {
    cleanupTmpDirs();
  }
}

let passed = 0;
let failed = 0;

console.log('\n=== validate-no-relative-scripts ===\n');

if (test('commands/, agents/, and skills/ docs pass validation', () => {
  const result = runValidator();
  assert.strictEqual(result.status, 0, `validator failed:\n${result.stdout}${result.stderr}`);
})) passed++; else failed++;

if (test('flags bare relative node scripts path', () => {
  const filePath = writeFixture(COMMANDS_DIR, 'bad.md', 'do not use relative paths\nnode scripts/lib/foo.js\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for bare node scripts path');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:2: node scripts/lib/foo.js`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags bare relative node hooks path', () => {
  const filePath = writeFixture(AGENTS_DIR, 'bad-hook.md', 'avoid hook path\nnode hooks/pre-commit.js\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for bare node hooks path');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:2: node hooks/pre-commit.js`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected hooks failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags bare relative node scripts path in skills', () => {
  const filePath = writeFixture(SKILLS_DIR, 'bad-skill.md', 'skill example\nnode scripts/lib/foo.js\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for bare node scripts path in skills');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:2: node scripts/lib/foo.js`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('allows resolver-based script invocations', () => {
  writeFixture(
    COMMANDS_DIR,
    'resolver.md',
    [
      'node "$DECISIONS_JS" query --domain domain_commands',
      'node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/lib/foo.js" --help',
    ].join('\n'),
  );
  const result = runValidator();
  assert.strictEqual(result.status, 0, `validator should allow resolver-based paths:\n${result.stdout}${result.stderr}`);
})) passed++; else failed++;

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
