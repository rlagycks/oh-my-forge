'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildOntologyDetailFragment,
  inferDomainFromDetailPath,
  mergeOntologyDetail,
  parseDesignContract,
  validateDesignContract,
  validateDesignContractFiles,
} = require('../../scripts/lib/design-contract');

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

let passed = 0;
let failed = 0;
const scriptPath = path.resolve(__dirname, '../../scripts/lib/design-contract.js');

const contractMarkdown = `
# Design Contract: Retry-safe Webhooks

## Problem One Line
- Prevent duplicate webhook side effects when retries happen.

## Mission
- Deliver webhook retries safely without widening the notification feature scope.

## Success
- Retry attempts are idempotent.
- Delivery failures surface clear evidence.

## Not Do
- Do not redesign the whole notification pipeline.

## Inputs / Contracts
- Existing webhook payload shape stays stable.
- Retry metadata must persist between attempts.

## Verification Points
- Unit tests prove repeated deliveries do not duplicate side effects.
- Integration test captures retry evidence in logs.

## False-Normal Checks
- A 200 response alone is not proof that side effects stayed idempotent.

## Expansion Forbidden
- No package swaps.
- No unrelated queue refactor.

## Handoff Format
- Current State
- Evidence
- Open Risks
- Next Action

## Open Assumptions
- Existing worker storage is available in production.
`;

const incompleteContractMarkdown = `
# Design Contract: Incomplete

## Problem One Line
- Fix retries.

## Mission
- Retry work.

## Success
- Tests pass.

## Handoff Format
- Current State
- Evidence
`;

const missingHandoffContractMarkdown = `
# Design Contract: Missing Handoff

## Problem One Line
- Prevent duplicate webhook side effects when retries happen.

## Mission
- Deliver webhook retries safely without widening the notification feature scope.

## Success
- Retry attempts are idempotent.

## Not Do
- Do not redesign the whole notification pipeline.

## Inputs / Contracts
- Existing webhook payload shape stays stable.

## Verification Points
- Unit tests prove repeated deliveries do not duplicate side effects.

## False-Normal Checks
- A 200 response alone is not proof that side effects stayed idempotent.

## Expansion Forbidden
- No package swaps.
`;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-contracts-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\ndesign-contract.test.js');

if (test('parseDesignContract extracts enforceable sections from markdown', () => {
  const parsed = parseDesignContract(contractMarkdown);

  assert.strictEqual(parsed.problemOneLine, 'Prevent duplicate webhook side effects when retries happen.');
  assert.ok(parsed.mission.includes('retries safely'), parsed.mission);
  assert.deepStrictEqual(parsed.success, [
    'Retry attempts are idempotent.',
    'Delivery failures surface clear evidence.',
  ]);
  assert.deepStrictEqual(parsed.notDo, [
    'Do not redesign the whole notification pipeline.',
  ]);
  assert.deepStrictEqual(parsed.inputsContracts, [
    'Existing webhook payload shape stays stable.',
    'Retry metadata must persist between attempts.',
  ]);
  assert.deepStrictEqual(parsed.handoffFormat, [
    'Current State',
    'Evidence',
    'Open Risks',
    'Next Action',
  ]);
})) passed++; else failed++;

if (test('validateDesignContract rejects contracts missing enforceable sections', () => {
  const parsed = parseDesignContract(incompleteContractMarkdown);
  const validation = validateDesignContract(parsed);

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('Not Do')), validation.errors.join('\n'));
  assert.ok(validation.errors.some(error => error.includes('Verification Points')), validation.errors.join('\n'));
  assert.ok(validation.errors.some(error => error.includes('False-Normal Checks')), validation.errors.join('\n'));
  assert.ok(validation.errors.some(error => error.includes('Expansion Forbidden')), validation.errors.join('\n'));
  assert.ok(validation.errors.some(error => error.includes('Open Risks')), validation.errors.join('\n'));
  assert.ok(validation.errors.some(error => error.includes('Next Action')), validation.errors.join('\n'));
})) passed++; else failed++;

if (test('validateDesignContract avoids redundant handoff item errors when handoff section is absent', () => {
  const parsed = parseDesignContract(missingHandoffContractMarkdown);
  const validation = validateDesignContract(parsed);

  assert.strictEqual(validation.valid, false);
  assert.ok(validation.errors.includes('Missing required design contract section: Handoff Format'), validation.errors.join('\n'));
  assert.ok(!validation.errors.some(error => error.includes('Handoff Format must include')), validation.errors.join('\n'));
})) passed++; else failed++;

if (test('validateDesignContract accepts complete execution contracts', () => {
  const validation = validateDesignContract(parseDesignContract(contractMarkdown));

  assert.strictEqual(validation.valid, true, validation.errors.join('\n'));
  assert.deepStrictEqual(validation.errors, []);
})) passed++; else failed++;

if (test('validateDesignContractFiles validates batches of contract files', () => {
  withTempDir(tempDir => {
    const validPath = path.join(tempDir, 'valid.design-contract.md');
    const invalidPath = path.join(tempDir, 'invalid.design-contract.md');
    fs.writeFileSync(validPath, contractMarkdown);
    fs.writeFileSync(invalidPath, incompleteContractMarkdown);

    const report = validateDesignContractFiles([invalidPath, validPath]);

    assert.strictEqual(report.valid, false);
    assert.strictEqual(report.files.length, 2);
    assert.deepStrictEqual(report.files.map(file => path.basename(file.file)), [
      'invalid.design-contract.md',
      'valid.design-contract.md',
    ]);
    assert.strictEqual(report.files[0].valid, false);
    assert.strictEqual(report.files[1].valid, true);
    assert.ok(report.files[0].errors.some(error => error.includes('Not Do')), report.files[0].errors.join('\n'));
  });
})) passed++; else failed++;

if (test('design-contract validate CLI exits non-zero for invalid batches', () => {
  withTempDir(tempDir => {
    const contractsDir = path.join(tempDir, 'contracts');
    fs.mkdirSync(contractsDir, { recursive: true });
    fs.writeFileSync(path.join(contractsDir, 'valid.design-contract.md'), contractMarkdown);
    fs.writeFileSync(path.join(contractsDir, 'invalid.design-contract.md'), incompleteContractMarkdown);

    const result = spawnSync(process.execPath, [scriptPath, 'validate', '--dir', contractsDir], {
      encoding: 'utf8',
    });

    assert.notStrictEqual(result.status, 0, result.stdout);
    assert.ok(result.stdout.includes('invalid.design-contract.md'), result.stdout);
    assert.ok(result.stdout.includes('Missing required design contract section: Not Do'), result.stdout);
  });
})) passed++; else failed++;

if (test('design-contract validate CLI reports missing flag values cleanly', () => {
  const result = spawnSync(process.execPath, [scriptPath, 'validate', '--file', '--json'], {
    encoding: 'utf8',
  });

  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stderr.includes('Missing value for --file'), result.stderr);
  assert.ok(!result.stderr.includes('TypeError'), result.stderr);
  assert.ok(!result.stderr.includes('at '), result.stderr);
})) passed++; else failed++;

if (test('design-contract validate CLI accepts a file path passed to --dir', () => {
  withTempDir(tempDir => {
    const contractPath = path.join(tempDir, 'valid.design-contract.md');
    fs.writeFileSync(contractPath, contractMarkdown);

    const result = spawnSync(process.execPath, [scriptPath, 'validate', '--dir', contractPath, '--json'], {
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.files.length, 1);
    assert.strictEqual(path.basename(report.files[0].file), 'valid.design-contract.md');
  });
})) passed++; else failed++;

if (test('design-contract validate CLI skips unrelated markdown and vendored dirs', () => {
  withTempDir(tempDir => {
    const contractsDir = path.join(tempDir, 'contracts');
    const nodeModulesDir = path.join(contractsDir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(path.join(contractsDir, 'valid.design-contract.md'), contractMarkdown);
    fs.writeFileSync(path.join(contractsDir, 'README.md'), '# Notes\n\nNot a design contract.');
    fs.writeFileSync(path.join(nodeModulesDir, 'invalid.design-contract.md'), incompleteContractMarkdown);

    const result = spawnSync(process.execPath, [scriptPath, 'validate', '--dir', contractsDir, '--json'], {
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.files.length, 1);
    assert.strictEqual(path.basename(report.files[0].file), 'valid.design-contract.md');
  });
})) passed++; else failed++;

if (test('buildOntologyDetailFragment maps design contract fields into ontology detail shape', () => {
  const parsed = parseDesignContract(contractMarkdown);
  const fragment = buildOntologyDetailFragment(parsed, {
    domain: 'domain_webhooks',
    contractFile: 'docs/contracts/retry-safe-webhooks.md',
  });

  assert.strictEqual(fragment.domain, 'domain_webhooks');
  assert.strictEqual(fragment.version, undefined);
  assert.strictEqual(fragment.summary, 'Prevent duplicate webhook side effects when retries happen.');
  assert.deepStrictEqual(fragment.source, ['docs/contracts/retry-safe-webhooks.md']);
  assert.deepStrictEqual(fragment.sourceDocs.designContract, ['docs/contracts/retry-safe-webhooks.md']);
  assert.deepStrictEqual(fragment.constraints, [
    'Existing webhook payload shape stays stable.',
    'Retry metadata must persist between attempts.',
  ]);
  assert.ok(fragment.executionContract.mission.includes('notification feature scope'), fragment.executionContract.mission);
  assert.ok(fragment.executionContract.notDo.includes('No package swaps.'), JSON.stringify(fragment, null, 2));
  assert.ok(fragment.executionContract.notDo.includes('No unrelated queue refactor.'), JSON.stringify(fragment, null, 2));
  assert.ok(fragment.completionContract.requiredEvidence.includes('Unit tests prove repeated deliveries do not duplicate side effects.'), JSON.stringify(fragment, null, 2));
  assert.ok(fragment.completionContract.falseNormalChecks.includes('A 200 response alone is not proof that side effects stayed idempotent.'), JSON.stringify(fragment, null, 2));
})) passed++; else failed++;

if (test('mergeOntologyDetail preserves existing metadata and unions contract fields', () => {
  const parsed = parseDesignContract(contractMarkdown);
  const fragment = buildOntologyDetailFragment(parsed, {
    domain: 'domain_webhooks',
    contractFile: 'docs/contracts/retry-safe-webhooks.md',
  });
  const merged = mergeOntologyDetail({
    domain: 'domain_webhooks',
    version: '1.0',
    summary: 'Existing summary',
    source: ['docs/api/webhooks.md'],
    constraints: ['Retry metadata must persist between attempts.'],
    sourceDocs: {
      apiSpec: ['docs/api/webhooks.md'],
    },
    executionContract: {
      mission: 'Old mission',
      notDo: ['Do not break auth'],
      success: ['Keep webhook auth working'],
    },
    completionContract: {
      requiredEvidence: ['Existing smoke test'],
    },
  }, fragment);

  assert.strictEqual(merged.summary, 'Prevent duplicate webhook side effects when retries happen.');
  assert.deepStrictEqual(merged.source, [
    'docs/api/webhooks.md',
    'docs/contracts/retry-safe-webhooks.md',
  ]);
  assert.deepStrictEqual(merged.sourceDocs, {
    apiSpec: ['docs/api/webhooks.md'],
    designContract: ['docs/contracts/retry-safe-webhooks.md'],
  });
  assert.ok(merged.executionContract.notDo.includes('Do not break auth'), JSON.stringify(merged, null, 2));
  assert.ok(merged.executionContract.notDo.includes('No package swaps.'), JSON.stringify(merged, null, 2));
  assert.ok(merged.executionContract.success.includes('Keep webhook auth working'), JSON.stringify(merged, null, 2));
  assert.ok(merged.completionContract.requiredEvidence.includes('Existing smoke test'), JSON.stringify(merged, null, 2));
  assert.ok(merged.completionContract.requiredEvidence.includes('Integration test captures retry evidence in logs.'), JSON.stringify(merged, null, 2));
})) passed++; else failed++;

if (test('inferDomainFromDetailPath derives the domain key from a detail filename', () => {
  assert.strictEqual(inferDomainFromDetailPath('.claude/ontology/domain_webhooks.json'), 'domain_webhooks');
  assert.strictEqual(inferDomainFromDetailPath('notes.md'), '');
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
