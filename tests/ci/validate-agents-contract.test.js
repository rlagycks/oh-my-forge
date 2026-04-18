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

function writeAgent(dir, fileName, bodySections, extraFrontmatter = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const extraLines = Object.entries(extraFrontmatter).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, fileName), [
    '---',
    `name: ${fileName.replace(/\.md$/, '')}`,
    'description: test agent',
    'tools: ["Read"]',
    'model: sonnet',
    ...extraLines,
    '---',
    '',
    ...bodySections,
    '',
  ].join('\n'), 'utf8');
}

let passed = 0;
let failed = 0;

console.log('\nvalidate-agents-contract.test.js');

if (test('validateAgents fails when any agent is missing contract sections', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'architect.md', [
    '## Mission',
    '- design systems',
    '## Success',
    '- clear design',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('Not Do')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Decision Policy')), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents does not warn for contract failures because missing sections are hard errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'architect.md', [
    '## Mission',
    '- design systems',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, false, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(result.warnings, []);
    assert.ok(result.errors.some(error => error.includes('architect.md')), result.errors.join('\n'));
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
    '- You may choose the safest local planning path.',
    '- Human approval is required for scope changes.',
    '- Escalate when requirements conflict.',
    '## Execution Policy',
    '- Start by confirming requirements before risky steps.',
    '- Do not finish without evidence and next action.',
    '## Style',
    '- Be concise and concrete.',
  ], { contract: 'strict' });

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(result.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents fails when contract sections are present but too vague', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'vague.md', [
    '## Mission',
    '- help with work',
    '## Not Do',
    '- stuff',
    '## Success',
    '- good outcome',
    '## Decision Policy',
    '- be smart',
    '## Execution Policy',
    '- work carefully',
    '## Style',
    '- nice',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('Not Do must include a concrete prohibition')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Decision Policy must state autonomous decision scope')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Decision Policy must state human approval boundary')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Decision Policy must state escalation criteria')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Execution Policy must state evidence or blocked completion criteria')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Style must state reporting or communication style')), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents ignores frontmatter rollout flags because all agents are strict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'my-agent.md', [
    '## Mission',
    '- do things',
  ], { contract: 'strict' });

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('my-agent.md')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Not Do')), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
