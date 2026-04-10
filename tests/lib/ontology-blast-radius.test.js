'use strict';

/**
 * Tests for scripts/lib/ontology-blast-radius.js
 *
 * Run with: node tests/lib/ontology-blast-radius.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { inferDependsOn, passPathOverlap, collectJsFiles } = require('../../scripts/lib/ontology-blast-radius');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;
function run(name, fn) {
  if (test(name, fn)) passed++;
  else failed++;
}

// --- Helpers ---

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-test-'));
}

function writeFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

console.log('\n=== Testing ontology-blast-radius ===\n');

// --- collectJsFiles ---

run('collectJsFiles returns js files from a directory entry', () => {
  const root = makeTmpDir();
  writeFile(root, 'lib/a.js', '');
  writeFile(root, 'lib/b.js', '');
  writeFile(root, 'lib/c.md', ''); // non-js, should be skipped
  const files = collectJsFiles(root, ['lib/']);
  assert.ok(files.some(f => f.endsWith('a.js')));
  assert.ok(files.some(f => f.endsWith('b.js')));
  assert.ok(!files.some(f => f.endsWith('c.md')));
  fs.rmSync(root, { recursive: true });
});

run('collectJsFiles returns a single .js file entry', () => {
  const root = makeTmpDir();
  writeFile(root, 'scripts/foo.js', '');
  const files = collectJsFiles(root, ['scripts/foo.js']);
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].endsWith('foo.js'));
  fs.rmSync(root, { recursive: true });
});

run('collectJsFiles skips non-existent paths silently', () => {
  const root = makeTmpDir();
  const files = collectJsFiles(root, ['no-such-dir/']);
  assert.deepStrictEqual(files, []);
  fs.rmSync(root, { recursive: true });
});

// --- passPathOverlap ---

run('passPathOverlap detects directory containment', () => {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });

  // domain_store owns lib/, domain_session owns lib/session.js (inside lib/)
  const indexJson = {
    domain_store: { files: ['lib/'] },
    domain_session: { files: ['lib/session.js'] },
  };

  const result = passPathOverlap(root, indexJson);
  // domain_session's file is inside domain_store's directory → session depends on store
  assert.ok(result.has('domain_session'), 'domain_session should have inferred dep');
  assert.ok(result.get('domain_session').has('domain_store'));
  fs.rmSync(root, { recursive: true });
});

run('passPathOverlap does not flag domains with no overlap', () => {
  const root = makeTmpDir();
  const indexJson = {
    domain_a: { files: ['src/a/'] },
    domain_b: { files: ['src/b/'] },
  };
  const result = passPathOverlap(root, indexJson);
  assert.ok(!result.has('domain_a'));
  assert.ok(!result.has('domain_b'));
  fs.rmSync(root, { recursive: true });
});

// --- inferDependsOn integration ---

run('inferDependsOn returns empty object when no new deps found', () => {
  const root = makeTmpDir();
  const indexJson = {
    domain_a: { files: ['src/a.js'], dependsOn: [] },
    domain_b: { files: ['src/b.js'], dependsOn: [] },
  };
  writeFile(root, 'src/a.js', "require('path');"); // bare module — ignored
  writeFile(root, 'src/b.js', '// no requires');
  const result = inferDependsOn(root, indexJson);
  assert.deepStrictEqual(result, {});
  fs.rmSync(root, { recursive: true });
});

run('inferDependsOn detects require() cross-domain dependency', () => {
  const root = makeTmpDir();
  // domain_lib owns lib/utils.js; domain_app owns app/main.js which requires lib/utils
  writeFile(root, 'lib/utils.js', 'module.exports = {};');
  writeFile(root, 'app/main.js', "const u = require('../lib/utils');");

  const indexJson = {
    domain_lib: { files: ['lib/utils.js'] },
    domain_app: { files: ['app/main.js'] },
  };

  const result = inferDependsOn(root, indexJson);
  assert.ok(result['domain_app'], 'domain_app should have inferred dep on domain_lib');
  assert.ok(result['domain_app'].includes('domain_lib'));
  fs.rmSync(root, { recursive: true });
});

run('inferDependsOn excludes already-declared dependsOn entries', () => {
  const root = makeTmpDir();
  writeFile(root, 'lib/utils.js', 'module.exports = {};');
  writeFile(root, 'app/main.js', "const u = require('../lib/utils');");

  const indexJson = {
    domain_lib: { files: ['lib/utils.js'] },
    domain_app: { files: ['app/main.js'], dependsOn: ['domain_lib'] }, // already declared
  };

  const result = inferDependsOn(root, indexJson);
  // domain_lib is already in dependsOn — should not appear in suggestions
  assert.ok(!result['domain_app'], 'domain_app already declares domain_lib — no suggestion expected');
  fs.rmSync(root, { recursive: true });
});

run('inferDependsOn works on the real project without throwing', () => {
  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const indexPath = path.join(REPO_ROOT, '.claude', 'ontology', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.log('    (skipped — index.json not found)');
    return;
  }
  const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const result = inferDependsOn(REPO_ROOT, indexJson);
  // Just verify it returns a plain object without throwing
  assert.strictEqual(typeof result, 'object');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
