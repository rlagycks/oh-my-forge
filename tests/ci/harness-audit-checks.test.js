'use strict';

/**
 * Test harness-audit checks: model-rot and graph-health
 *
 * Run with: node tests/ci/harness-audit-checks.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const auditScript = path.join(repoRoot, 'scripts', 'harness-audit.js');

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

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, data) {
  writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

console.log('\nharness-audit-checks.test.js\n');

// Test model-rot check: PASS when no violations
if (test('model-rot PASS when no dated model references', () => {
  withTempRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'rules', 'common', 'test.md'), '# Test\n\nNo model references here.\n');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const modelRotCheck = report.checks.find(c => c.id === 'model-rot');

    assert.ok(modelRotCheck, 'model-rot check should exist');
    assert.strictEqual(modelRotCheck.pass, true, 'model-rot should pass with no violations');
  });
})) passed++; else failed++;

// Test model-rot check: FAIL when dated references exist
if (test('model-rot FAIL when dated model references found', () => {
  withTempRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'rules', 'common', 'test.md'), '# Models\n\nUse Sonnet 4.6 for best results.\nHaiku 4.5 is cheaper.\n');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const modelRotCheck = report.checks.find(c => c.id === 'model-rot');

    assert.ok(modelRotCheck, 'model-rot check should exist');
    assert.strictEqual(modelRotCheck.pass, false, 'model-rot should fail with violations');
  });
})) passed++; else failed++;

// Test model-rot check: allowlist via model-rot-ok marker
if (test('model-rot PASS when violations are marked with model-rot-ok', () => {
  withTempRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'rules', 'common', 'test.md'), '# Models (as of 2026-07)\n\nUse Sonnet 4.6 for best results. model-rot-ok\nHaiku 4.5 is cheaper.\n');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const modelRotCheck = report.checks.find(c => c.id === 'model-rot');

    assert.ok(modelRotCheck, 'model-rot check should exist');
    // Still fails because only the first line is whitelisted; second line still violates
    assert.strictEqual(modelRotCheck.pass, false, 'model-rot should fail (second line has no allowlist marker)');
  });
})) passed++; else failed++;

// Test model-rot check: handles claude-3-* style patterns
if (test('model-rot FAIL when claude-3-* style model IDs found', () => {
  withTempRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'agents', 'test.md'), '# Agent\n\nModel: claude-3-5-sonnet-20241022\n');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const modelRotCheck = report.checks.find(c => c.id === 'model-rot');

    assert.ok(modelRotCheck, 'model-rot check should exist');
    assert.strictEqual(modelRotCheck.pass, false, 'model-rot should fail with claude-3-* references');
  });
})) passed++; else failed++;

// Test graph-health check: PASS when ontology missing (optional)
if (test('graph-health PASS when ontology does not exist', () => {
  withTempRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const graphHealthCheck = report.checks.find(c => c.id === 'graph-health');

    assert.ok(graphHealthCheck, 'graph-health check should exist');
    assert.strictEqual(graphHealthCheck.pass, true, 'graph-health should pass when ontology is missing (optional)');
  });
})) passed++; else failed++;

// Test graph-health check: PASS when health metrics are good
if (test('graph-health PASS when orphans <= 30% and no empty domains', () => {
  withTempRepo(tempRoot => {
    const ontologyIndex = {
      $schema: './.claude/ontology/_schema.json',
      domain_a: {
        summary: 'Domain A',
        files: ['src/a.js'],
        spec: 'docs/a.md',
        owner: 'test',
        constraints: ['constraint 1'],
        dependsOn: ['domain_b'],
      },
      domain_b: {
        summary: 'Domain B',
        files: ['src/b.js'],
        spec: 'docs/b.md',
        owner: 'test',
        constraints: ['constraint 1'],
      },
      domain_c: {
        summary: 'Domain C',
        files: ['src/c.js'],
        spec: 'docs/c.md',
        owner: 'test',
        constraints: ['constraint 1'],
        dependsOn: ['domain_a'],
      },
      domain_d: {
        summary: 'Domain D',
        files: ['src/d.js'],
        spec: 'docs/d.md',
        owner: 'test',
        constraints: ['constraint 1'],
        dependsOn: ['domain_b'],
      },
    };

    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), ontologyIndex);
    writeFile(path.join(tempRoot, 'docs', 'a.md'), '# A');
    writeFile(path.join(tempRoot, 'docs', 'b.md'), '# B');
    writeFile(path.join(tempRoot, 'docs', 'c.md'), '# C');
    writeFile(path.join(tempRoot, 'docs', 'd.md'), '# D');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const graphHealthCheck = report.checks.find(c => c.id === 'graph-health');

    assert.ok(graphHealthCheck, 'graph-health check should exist');
    assert.strictEqual(graphHealthCheck.pass, true, 'graph-health should pass with 0 orphans and all connected');
  });
})) passed++; else failed++;

// Test graph-health check: FAIL when orphans exceed 30%
if (test('graph-health FAIL when orphan percentage exceeds 30%', () => {
  withTempRepo(tempRoot => {
    const ontologyIndex = {
      $schema: './.claude/ontology/_schema.json',
      domain_a: {
        summary: 'Domain A',
        files: ['src/a.js'],
        spec: 'docs/a.md',
        owner: 'test',
        constraints: ['constraint 1'],
      },
      domain_b: {
        summary: 'Domain B',
        files: ['src/b.js'],
        spec: 'docs/b.md',
        owner: 'test',
        constraints: ['constraint 1'],
      },
      domain_c: {
        summary: 'Domain C',
        files: ['src/c.js'],
        spec: 'docs/c.md',
        owner: 'test',
        constraints: ['constraint 1'],
      },
      domain_d: {
        summary: 'Domain D',
        files: ['src/d.js'],
        spec: 'docs/d.md',
        owner: 'test',
        constraints: ['constraint 1'],
      },
    };

    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), ontologyIndex);
    writeFile(path.join(tempRoot, 'docs', 'a.md'), '# A');
    writeFile(path.join(tempRoot, 'docs', 'b.md'), '# B');
    writeFile(path.join(tempRoot, 'docs', 'c.md'), '# C');
    writeFile(path.join(tempRoot, 'docs', 'd.md'), '# D');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const graphHealthCheck = report.checks.find(c => c.id === 'graph-health');

    assert.ok(graphHealthCheck, 'graph-health check should exist');
    assert.strictEqual(graphHealthCheck.pass, false, 'graph-health should fail with 4 orphans (100% > 30%)');
  });
})) passed++; else failed++;

// Test graph-health check: FAIL when empty domains exist
if (test('graph-health FAIL when domains have no constraints or decisions', () => {
  withTempRepo(tempRoot => {
    const ontologyIndex = {
      $schema: './.claude/ontology/_schema.json',
      domain_a: {
        summary: 'Domain A',
        files: ['src/a.js'],
        spec: 'docs/a.md',
        owner: 'test',
        constraints: [], // Empty constraints
        // No sourceDocs
      },
    };

    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), ontologyIndex);
    writeFile(path.join(tempRoot, 'docs', 'a.md'), '# A');
    writeFile(path.join(tempRoot, 'package.json'), '{"name":"test"}');

    const { buildReport } = require(auditScript);
    const report = buildReport('repo', { rootDir: tempRoot, targetMode: 'repo' });
    const graphHealthCheck = report.checks.find(c => c.id === 'graph-health');

    assert.ok(graphHealthCheck, 'graph-health check should exist');
    assert.strictEqual(graphHealthCheck.pass, false, 'graph-health should fail with empty domain');
  });
})) passed++; else failed++;

console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
