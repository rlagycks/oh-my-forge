'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractPlanFiles } = require('../../scripts/lib/plan-workflow');

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

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function touch(filePath) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, 'x\n', 'utf8');
}

let passed = 0;
let failed = 0;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-workflow-'));
const routingRoot = path.join(root, 'repo');
mkdirp(routingRoot);
touch(path.join(routingRoot, 'src', 'a.js'));
touch(path.join(routingRoot, 'src', 'b.ts'));

if (test('extractPlanFiles finds File: labels, backticks, and bare path tokens', () => {
  const markdown = `
# Implementation Plan: Example

### Phase 1
1. Do thing (File: src/a.js)
2. Update \`src/b.ts\`
3. Mention bare token src/c/new-file.ts (planned)

Ignore flags like --help and URLs like https://example.com/src/a.js
`;
  const files = extractPlanFiles(markdown, { routingRoot });
  assert.deepStrictEqual(files, ['src/a.js', 'src/b.ts', 'src/c/new-file.ts']);
})) passed++; else failed++;

if (test('extractPlanFiles ignores obvious non-path tokens', () => {
  const markdown = `
Files: --write, --fresh
ENV_VAR: CODEX_SESSION
\`--not-a-path\`
`;
  const files = extractPlanFiles(markdown, { routingRoot });
  assert.deepStrictEqual(files, []);
})) passed++; else failed++;

if (test('extractPlanFiles normalizes punctuation, Windows separators, CSV labels, and duplicates', () => {
  touch(path.join(routingRoot, 'lib', 'existing.js'));
  const markdown = `
Files: (src/a.js), lib\\existing.js, src/a.js
Also review "src/new.ts" and \`src/new.ts\`.
`;
  const files = extractPlanFiles(markdown, { routingRoot });
  assert.deepStrictEqual(files, ['src/a.js', 'lib/existing.js', 'src/new.ts']);
})) passed++; else failed++;

if (test('extractPlanFiles rejects environment, URL, and oversized path candidates', () => {
  const oversized = `src/${'x'.repeat(250)}.js`;
  const markdown = `
Files:
# section/path.md
HTTPS://example.test/src/a.js
ENVIRONMENT_VAR
\`inline\\npath.js\`
${oversized}
`;
  assert.deepStrictEqual(extractPlanFiles(markdown, { routingRoot }), ['inline/npath.js', 'section/path.md']);
  assert.deepStrictEqual(extractPlanFiles('', { routingRoot }), []);
})) passed++; else failed++;

if (test('extractPlanFiles keeps absolute planned paths and supports missing routing roots', () => {
  const plannedAbsolute = path.join(root, 'new', 'planned.ts');
  const files = extractPlanFiles(`File: ${plannedAbsolute}`, { routingRoot: path.join(root, 'missing') });
  assert.deepStrictEqual(files, [plannedAbsolute]);
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
