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

if (test('flags plugin-root dot fallback that breaks marketplace installs', () => {
  const filePath = writeFixture(COMMANDS_DIR, 'bad-plugin-root.md', 'PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-.}}\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for plugin-root dot fallback');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:1: PLUGIN_ROOT=\${CLAUDE_PLUGIN_ROOT:-\${CODEX_PLUGIN_ROOT:-.}}`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags CLAUDE_PLUGIN_ROOT-only skill script references', () => {
  const filePath = writeFixture(COMMANDS_DIR, 'bad-claude-only.md', 'python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" status\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for CLAUDE_PLUGIN_ROOT-only skill script path');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:1: python3 "\${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" status`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags hardcoded ~/.claude skill script execution paths', () => {
  const filePath = writeFixture(SKILLS_DIR, 'bad-global-skill.md', 'bash ~/.claude/skills/rules-distill/scripts/scan-skills.sh\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for hardcoded ~/.claude skill script path');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:1: bash ~/.claude/skills/rules-distill/scripts/scan-skills.sh`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags shell snippets that escape double quotes inside single-quoted node -p payloads', () => {
  const filePath = writeFixture(
    COMMANDS_DIR,
    'bad-node-p-escaping.md',
    [
      '```bash',
      'PLUGIN_ROOT="$(node -p \'(()=>{var p=require(\\"path\\");return p.join(\\"/tmp\\",\\"omf\\")})()\')"',
      '```',
    ].join('\n')
  );
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for invalid escaping inside single-quoted node -p payloads');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:2: PLUGIN_ROOT="$(node -p '(()=>{var p=require(\\"path\\");return p.join(\\"/tmp\\",\\"omf\\")})()')"`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('flags relative script executions even when other shell variables appear on the same line', () => {
  const filePath = writeFixture(COMMANDS_DIR, 'bad-mixed-shell.md', 'echo "$HOME"; node scripts/lib/foo.js\n');
  const result = runValidator();
  assert.notStrictEqual(result.status, 0, 'validator should fail for relative node scripts path even when unrelated shell variables are present');
  const relative = path.relative(ROOT, filePath);
  const expected = `FAIL: ${relative}:1: echo "$HOME"; node scripts/lib/foo.js`;
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(output.includes(expected), `missing expected failure line: ${expected}\nOutput:\n${output}`);
})) passed++; else failed++;

if (test('allows resolver-based script invocations', () => {
  writeFixture(
    COMMANDS_DIR,
    'resolver.md',
    [
      'node "$DECISIONS_JS" query --domain domain_commands',
      'PLUGIN_ROOT="$(node -p \'(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);return e&&e.trim()?e.trim():require(`os`).homedir()})()\')"',
      'node "$PLUGIN_ROOT/scripts/lib/foo.js" --help',
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
