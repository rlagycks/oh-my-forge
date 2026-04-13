'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPlanRoute } = require('../../scripts/lib/codex-handoff');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plan-route-'));
  const projectRoot = path.join(root, 'project');

  mkdirp(path.join(projectRoot, '.claude', 'ontology'));
  mkdirp(path.join(projectRoot, 'src', 'hooks'));
  mkdirp(path.join(projectRoot, 'src', 'utils'));
  mkdirp(path.join(projectRoot, 'misc'));

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_utils: {
      summary: 'Shared utilities',
      files: ['src/utils/'],
      constraints: ['No mutable shared state'],
      dependsOn: [],
    },
    domain_hooks: {
      summary: 'Hook implementations',
      files: ['src/hooks/'],
      constraints: ['Foreground only'],
      dependsOn: ['domain_utils'],
    },
  });

  return { root, projectRoot };
}

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

console.log('\nplan-routing.test.js');

if (test('createPlanRoute groups matched files by domain and appends unmatched fallback', () => {
  const fixture = makeFixture();
  try {
    const route = createPlanRoute({
      engine: 'codex',
      routingRoot: fixture.projectRoot,
      planFile: path.join(fixture.projectRoot, '.claude', 'plans', 'retry.md'),
      featureName: 'Retry Guard',
      task: 'Implement retry guard changes',
      files: [
        path.join(fixture.projectRoot, 'src', 'hooks', 'guard.js'),
        path.join(fixture.projectRoot, 'src', 'utils', 'shared.js'),
        path.join(fixture.projectRoot, 'misc', 'unmatched.js'),
      ],
    });

    assert.strictEqual(route.state, 'ROUTED');
    assert.strictEqual(route.ontology, 'project-local match');
    assert.strictEqual(route.handoffs.length, 3);
    assert.strictEqual(route.handoffs[0].source, 'plan-auto');
    assert.strictEqual(route.handoffs[0].domainId, 'domain_utils');
    assert.strictEqual(route.handoffs[1].source, 'plan-auto');
    assert.strictEqual(route.handoffs[1].domainId, 'domain_hooks');
    assert.strictEqual(route.handoffs[2].source, 'plan-auto');
    assert.strictEqual(route.handoffs[2].kind, 'fallback');
    assert.deepStrictEqual(route.handoffs[2].files, ['misc/unmatched.js']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('createPlanRoute falls back when no ontology is present but files exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plan-route-no-ontology-'));
  try {
    const route = createPlanRoute({
      engine: 'codex',
      routingRoot: root,
      planFile: path.join(root, '.claude', 'plans', 'retry.md'),
      featureName: 'Retry Guard',
      task: 'Implement retry guard changes',
      files: [path.join(root, 'src', 'untracked.js')],
    });

    assert.strictEqual(route.state, 'ROUTED');
    assert.strictEqual(route.ontology, 'none');
    assert.strictEqual(route.handoffs.length, 1);
    assert.strictEqual(route.handoffs[0].source, 'plan-auto');
    assert.strictEqual(route.handoffs[0].kind, 'fallback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('createPlanRoute blocks codex routing when there are no files to route', () => {
  const fixture = makeFixture();
  try {
    const route = createPlanRoute({
      engine: 'codex',
      routingRoot: fixture.projectRoot,
      planFile: path.join(fixture.projectRoot, '.claude', 'plans', 'retry.md'),
      featureName: 'Retry Guard',
      task: 'Implement retry guard changes',
      files: [],
    });

    assert.strictEqual(route.state, 'BLOCKED');
    assert.ok(route.reason.includes('No file paths'), route.reason);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('createPlanRoute reports claude inline mode without codex handoffs', () => {
  const fixture = makeFixture();
  try {
    const route = createPlanRoute({
      engine: 'claude',
      routingRoot: fixture.projectRoot,
      planFile: path.join(fixture.projectRoot, '.claude', 'plans', 'retry.md'),
      featureName: 'Retry Guard',
      task: 'Implement retry guard changes',
      files: [path.join(fixture.projectRoot, 'src', 'hooks', 'guard.js')],
    });

    assert.strictEqual(route.state, 'ROUTED');
    assert.strictEqual(route.engine, 'claude');
    assert.strictEqual(route.route, 'claude-inline');
    assert.deepStrictEqual(route.handoffs, []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
