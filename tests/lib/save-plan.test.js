'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { savePlan, slugify, timestamp } = require('../../scripts/lib/save-plan');

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

console.log('\n=== Testing save-plan ===\n');

// ── slugify ──────────────────────────────────────────────────────────────────

run('slugify: lowercases and replaces spaces with hyphens', () => {
  assert.strictEqual(slugify('My Feature Name'), 'my-feature-name');
});

run('slugify: removes leading/trailing hyphens', () => {
  assert.strictEqual(slugify('  feature  '), 'feature');
});

run('slugify: strips special characters', () => {
  assert.strictEqual(slugify('feat: add OAuth2 (v2)!'), 'feat-add-oauth2-v2');
});

run('slugify: falls back to "plan" for empty string', () => {
  assert.strictEqual(slugify(''), 'plan');
});

run('slugify: falls back to "plan" for undefined', () => {
  assert.strictEqual(slugify(undefined), 'plan');
});

run('slugify: truncates to 60 chars', () => {
  const long = 'a'.repeat(80);
  assert.strictEqual(slugify(long).length, 60);
});

// ── timestamp ────────────────────────────────────────────────────────────────

run('timestamp: returns YYYYMMDD-HHmm format', () => {
  const d = new Date(2026, 3, 10, 14, 5); // 2026-04-10 14:05
  assert.strictEqual(timestamp(d), '20260410-1405');
});

run('timestamp: zero-pads month, day, hour, minute', () => {
  const d = new Date(2026, 0, 1, 9, 3); // 2026-01-01 09:03
  assert.strictEqual(timestamp(d), '20260101-0903');
});

// ── savePlan ─────────────────────────────────────────────────────────────────

function makeTmpPlansDir() {
  // Redirect ~/.claude/plans to a temp dir by monkey-patching os.homedir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-plan-test-'));
  fs.mkdirSync(path.join(tmpDir, '.claude', 'plans'), { recursive: true });
  return tmpDir;
}

run('savePlan: creates file and returns absolute path', () => {
  const tmpHome = makeTmpPlansDir();
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const filePath = savePlan({
      content: '# Plan\n\nTest plan content.',
      name: 'test-feature',
      date: new Date(2026, 3, 10, 10, 0),
    });

    assert.ok(fs.existsSync(filePath), 'file should exist');
    assert.ok(filePath.endsWith('test-feature-20260410-1000.md'), `unexpected filename: ${filePath}`);
  } finally {
    os.homedir = origHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('savePlan: written content matches input', () => {
  const tmpHome = makeTmpPlansDir();
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const content = '# Plan\n\nPhase 1: setup\nPhase 2: implement\n';
    const filePath = savePlan({ content, name: 'content-check', date: new Date(2026, 3, 10, 10, 0) });
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), content);
  } finally {
    os.homedir = origHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('savePlan: creates plans dir if it does not exist', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'save-plan-nodir-'));
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const filePath = savePlan({ content: '# Plan', name: 'mkdir-test', date: new Date(2026, 3, 10, 10, 0) });
    assert.ok(fs.existsSync(filePath));
  } finally {
    os.homedir = origHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('savePlan: throws on empty content', () => {
  assert.throws(
    () => savePlan({ content: '', name: 'empty' }),
    /must not be empty/
  );
});

run('savePlan: uses "plan" slug when name is omitted', () => {
  const tmpHome = makeTmpPlansDir();
  const origHomedir = os.homedir;
  os.homedir = () => tmpHome;

  try {
    const filePath = savePlan({ content: '# Plan', date: new Date(2026, 3, 10, 10, 0) });
    assert.ok(path.basename(filePath).startsWith('plan-'), `basename: ${path.basename(filePath)}`);
  } finally {
    os.homedir = origHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
