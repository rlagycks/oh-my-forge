'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateAgents,
} = require('../../scripts/ci/validate-agents');

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

function writeAgent(dir, fileName, bodySections) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), [
    '---',
    `name: ${fileName.replace(/\.md$/, '')}`,
    'description: test agent',
    'tools: ["Read"]',
    'model: sonnet',
    '---',
    '',
    ...bodySections,
    '',
  ].join('\n'), 'utf8');
}

let passed = 0;
let failed = 0;

console.log('\nvalidate-agents-contract.test.js');

if (test('validateAgents fails when a strict agent is missing contract sections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'planner.md', [
    '## Mission',
    '- plan work',
    '## Success',
    '- clear plan',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
      strictContractAgents: ['planner'],
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('Not Do')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Decision Policy')), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents warns for non-strict agents but does not fail the run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'architect.md', [
    '## Mission',
    '- design systems',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
      strictContractAgents: ['planner'],
    });

    assert.strictEqual(result.valid, true, JSON.stringify(result, null, 2));
    assert.ok(result.warnings.some(warning => warning.includes('architect.md')), result.warnings.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents passes when a strict agent contains the full contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'planner.md', [
    '## Mission',
    '- plan work',
    '## Not Do',
    '- do not code',
    '## Success',
    '- plan is actionable',
    '## Decision Policy',
    '- choose the safest path',
    '## Execution Policy',
    '- checkpoint before risky steps',
    '## Style',
    '- concise',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
      strictContractAgents: ['planner'],
    });

    assert.strictEqual(result.valid, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(result.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
