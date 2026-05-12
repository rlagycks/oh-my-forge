'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  resolveInstallPlan,
} = require('../../scripts/lib/install-manifests');

const repoRoot = path.resolve(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

let passed = 0;
let failed = 0;

console.log('\ncodex-home-config.test.js');

if (test('project-local Codex config omits user-level-only keys', () => {
  const config = readText('.codex/config.toml');
  assert.ok(!/^\s*notify\s*=/m.test(config), 'project-local config should not define notify');
  assert.ok(!/^\[profiles\./m.test(config), 'project-local config should not define profiles');
  assert.ok(/^\s*codex_hooks\s*=\s*true/m.test(config), 'project-local config should enable codex hooks');
})) passed++; else failed++;

if (test('user-level Codex config template keeps notify and profiles', () => {
  const config = readText('.codex/config.user.toml');
  assert.ok(/^\s*notify\s*=/m.test(config), 'user-level template should define notify');
  assert.ok(/^\[profiles\.strict\]/m.test(config), 'user-level template should define profiles.strict');
  assert.ok(/^\[profiles\.yolo\]/m.test(config), 'user-level template should define profiles.yolo');
})) passed++; else failed++;

if (test('Codex home install remaps config.user.toml to config.toml and omits project-local hooks', () => {
  const plan = resolveInstallPlan({
    repoRoot,
    projectRoot: repoRoot,
    profileId: 'core',
    target: 'codex',
    homeDir: path.join(repoRoot, '.tmp-test-home'),
  });

  const sourcePaths = plan.operations.map(operation => operation.sourceRelativePath.replace(/\\/g, '/'));
  const configOperation = plan.operations.find(operation => (
    operation.sourceRelativePath.replace(/\\/g, '/') === '.codex/config.user.toml'
    && operation.destinationPath.replace(/\\/g, '/').endsWith('/.codex/config.toml')
  ));

  assert.ok(configOperation, 'expected codex-home install to source .codex/config.user.toml');
  assert.ok(!sourcePaths.includes('.codex/hooks.json'), 'codex-home install should omit project-local hooks.json');
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
