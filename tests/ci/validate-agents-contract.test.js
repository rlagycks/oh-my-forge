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
    assert.ok(result.errors.some(error => error.includes('Execution Policy must state start or checkpoint criteria')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Execution Policy must state evidence or blocked completion criteria')), result.errors.join('\n'));
    assert.ok(result.errors.some(error => error.includes('Style must state reporting or communication style')), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('validateAgents accepts Korean contract policy wording', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'planner-ko.md', [
    '## Mission',
    '- 작업 계획을 만든다.',
    '## Not Do',
    '- 구현 코드를 임의로 수정하지 않는다.',
    '## Success',
    '- 사람이 다음 액션을 바로 고를 수 있다.',
    '## Decision Policy',
    '- 작은 순서 조정은 혼자 결정 가능.',
    '- 범위 변경은 사람 승인 필요.',
    '- 요구사항 충돌은 에스컬레이션한다.',
    '## Execution Policy',
    '- 시작 전에 입력과 제약을 확인한다.',
    '- 증거 또는 blocked 사유 없이 완료하지 않는다.',
    '## Style',
    '- 간결하고 구체적인 보고 톤을 유지한다.',
  ]);

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

if (test('validateAgents stops section extraction at H1 headings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-agents-'));
  const agentsDir = path.join(root, 'agents');
  writeAgent(agentsDir, 'h1-boundary.md', [
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
    '- nice',
    '# Later Notes',
    '- concise and concrete details outside Style must not satisfy Style.',
  ]);

  try {
    const result = validateAgents({
      agentDirs: [agentsDir],
    });

    assert.strictEqual(result.valid, false);
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
