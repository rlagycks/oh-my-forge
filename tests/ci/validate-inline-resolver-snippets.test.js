'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateInlineResolverSnippets,
} = require('../../scripts/ci/validate-inline-resolver-snippets');
const {
  INLINE_RESOLVE_SHELL,
  INLINE_RESOLVE_JS,
} = require('../../scripts/lib/resolve-ecc-root');

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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-resolver-snippets-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

console.log('\nvalidate-inline-resolver-snippets.test.js');

if (test('accepts shell snippets that match INLINE_RESOLVE_SHELL exactly', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'commands', 'example.md'),
      `PLUGIN_ROOT="${INLINE_RESOLVE_SHELL}"\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 1);
  });
})) passed++; else failed++;

if (test('accepts shell snippets with a path suffix appended after the resolver', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'commands', 'example.md'),
      `DECISIONS_JS="${INLINE_RESOLVE_SHELL}/scripts/lib/decisions.js"\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 1);
  });
})) passed++; else failed++;

if (test('accepts JSON-escaped-quote shell snippets inside hook config examples', () => {
  withRepo(tempRoot => {
    const escaped = INLINE_RESOLVE_SHELL.replace(/"/g, '\\"');
    writeFile(
      path.join(tempRoot, 'skills', 'example', 'SKILL.md'),
      `        "command": "bash \\"${escaped}/skills/example/hook.sh\\""\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 1);
  });
})) passed++; else failed++;

if (test('accepts raw JS snippets that match INLINE_RESOLVE_JS exactly', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'commands', 'sessions.md'),
      `const root = ${INLINE_RESOLVE_JS};\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 1);
  });
})) passed++; else failed++;

if (test('accepts raw JS require() snippets that match INLINE_RESOLVE_JS exactly', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'commands', 'sessions.md'),
      `const aa = require(${INLINE_RESOLVE_JS}+'/scripts/lib/session-aliases');\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 1);
  });
})) passed++; else failed++;

if (test('flags shell snippets that drift from INLINE_RESOLVE_SHELL', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'commands', 'example.md'),
      'PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-$HOME/.claude}}"\n'
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.strictEqual(report.checked, 1);
    assert.strictEqual(report.failures.length, 1);
    assert.ok(report.failures[0].includes('inline resolver drifted'));
  });
})) passed++; else failed++;

if (test('flags stale copies of the old retired inline JS probing blob', () => {
  withRepo(tempRoot => {
    writeFile(
      path.join(tempRoot, 'agents', 'planner.md'),
      `const root = (()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);return e || "stale"})();\n`
    );

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.strictEqual(report.checked, 1);
    assert.strictEqual(report.failures.length, 1);
    assert.ok(report.failures[0].includes('inline resolver drifted'));
  });
})) passed++; else failed++;

if (test('ignores markdown files without resolver snippets', () => {
  withRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'skills', 'plain.md'), '# No resolver here\n');

    const report = validateInlineResolverSnippets({ repoRoot: tempRoot });
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.checked, 0);
  });
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
