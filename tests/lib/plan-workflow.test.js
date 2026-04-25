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

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

