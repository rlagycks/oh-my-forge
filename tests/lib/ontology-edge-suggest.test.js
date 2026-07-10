'use strict';

/**
 * Tests for scripts/lib/ontology-edge-suggest.js
 *
 * Run with: node tests/lib/ontology-edge-suggest.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { suggestEdges, resolveOntologyDir, loadDomains } = require('../../scripts/lib/ontology-edge-suggest');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-edge-suggest-test-'));
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

function writeIndex(root, index) {
  return writeFile(root, '.claude/ontology/index.json', JSON.stringify(index, null, 2));
}

console.log('\n=== Testing ontology-edge-suggest ===\n');

// --- resolveOntologyDir ---

run('resolveOntologyDir finds index.json directly in the given dir', () => {
  const root = makeTmpDir();
  writeIndex(root, { $schema: './x' });
  const found = resolveOntologyDir(path.join(root, '.claude', 'ontology'));
  assert.strictEqual(found, path.join(root, '.claude', 'ontology'));
  fs.rmSync(root, { recursive: true });
});

run('resolveOntologyDir finds index.json via project root fallback', () => {
  const root = makeTmpDir();
  writeIndex(root, { $schema: './x' });
  const found = resolveOntologyDir(root);
  assert.strictEqual(found, path.join(root, '.claude', 'ontology'));
  fs.rmSync(root, { recursive: true });
});

run('resolveOntologyDir returns null when no index.json exists anywhere', () => {
  const root = makeTmpDir();
  const found = resolveOntologyDir(root);
  assert.strictEqual(found, null);
  fs.rmSync(root, { recursive: true });
});

// --- loadDomains ---

run('loadDomains reads a flat-format index.json', () => {
  const root = makeTmpDir();
  writeIndex(root, {
    $schema: './x',
    domain_a: { files: ['lib/a.js'], spec: 'docs/a.md', dependsOn: [] },
  });
  const { domains, projectRoot } = loadDomains(path.join(root, '.claude', 'ontology'));
  assert.deepStrictEqual(domains.domain_a.files, ['lib/a.js']);
  assert.strictEqual(domains.domain_a.spec, 'docs/a.md');
  assert.strictEqual(projectRoot, root);
  fs.rmSync(root, { recursive: true });
});

run('loadDomains reads a split-format index.json (domains: {key: ref})', () => {
  const root = makeTmpDir();
  writeFile(root, '.claude/ontology/domain_a.json', JSON.stringify({ source: ['lib/a.js'], spec: 'docs/a.md', dependsOn: [] }));
  writeIndex(root, { version: '1.0', domains: { domain_a: './domain_a.json' } });
  const { domains } = loadDomains(path.join(root, '.claude', 'ontology'));
  assert.deepStrictEqual(domains.domain_a.files, ['lib/a.js']);
  fs.rmSync(root, { recursive: true });
});

// --- suggestEdges: spec-reference evidence ---

run('suggestEdges proposes an edge when spec text mentions another domain key', () => {
  const root = makeTmpDir();
  writeFile(root, 'docs/a.md', 'This domain depends on domain_b for storage.');
  writeFile(root, 'docs/b.md', 'Nothing special here.');
  writeIndex(root, {
    $schema: './x',
    domain_a: { files: [], spec: 'docs/a.md', dependsOn: [] },
    domain_b: { files: [], spec: 'docs/b.md', dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  const hit = suggestions.find(s => s.from === 'domain_a' && s.to === 'domain_b');
  assert.ok(hit, 'expected domain_a -> domain_b suggestion');
  assert.ok(hit.evidence.some(e => e.includes('domain_b')));
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges does not propose an edge already present in dependsOn', () => {
  const root = makeTmpDir();
  writeFile(root, 'docs/a.md', 'This domain depends on domain_b for storage.');
  writeFile(root, 'docs/b.md', 'Nothing special here.');
  writeIndex(root, {
    $schema: './x',
    domain_a: { files: [], spec: 'docs/a.md', dependsOn: ['domain_b'] },
    domain_b: { files: [], spec: 'docs/b.md', dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  assert.ok(!suggestions.some(s => s.from === 'domain_a' && s.to === 'domain_b'));
  fs.rmSync(root, { recursive: true });
});

// --- suggestEdges: file-reference evidence ---

run('suggestEdges proposes an edge when a file require()s a file tracked by another domain', () => {
  const root = makeTmpDir();
  writeFile(root, 'lib/session-manager.js', 'module.exports = {};');
  writeFile(root, 'lib/orchestrator.js', "const sm = require('./session-manager');\nmodule.exports = sm;");
  writeIndex(root, {
    $schema: './x',
    domain_session: { files: ['lib/session-manager.js'], spec: null, dependsOn: [] },
    domain_orchestration: { files: ['lib/orchestrator.js'], spec: null, dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  const hit = suggestions.find(s => s.from === 'domain_orchestration' && s.to === 'domain_session');
  assert.ok(hit, 'expected domain_orchestration -> domain_session suggestion');
  assert.ok(hit.evidence.some(e => e.includes('require()')));
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges proposes an edge when a file mentions another domain\'s tracked path as plain text', () => {
  const root = makeTmpDir();
  writeFile(root, 'scripts/lib/session-manager.js', 'module.exports = {};');
  writeFile(root, 'commands/some-command.md', 'See scripts/lib/session-manager.js for details.');
  writeIndex(root, {
    $schema: './x',
    domain_session: { files: ['scripts/lib/session-manager.js'], spec: null, dependsOn: [] },
    domain_commands: { files: ['commands/some-command.md'], spec: null, dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  const hit = suggestions.find(s => s.from === 'domain_commands' && s.to === 'domain_session');
  assert.ok(hit, 'expected domain_commands -> domain_session suggestion');
  assert.ok(hit.evidence.some(e => e.includes('mentions path')));
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges ignores bare directory entries and generic filenames as match targets', () => {
  const root = makeTmpDir();
  writeFile(root, 'agents/foo.md', 'See agents/ and CLAUDE.md and package.json for conventions.');
  writeFile(root, 'CLAUDE.md', '# root doc');
  writeFile(root, 'package.json', '{}');
  writeIndex(root, {
    $schema: './x',
    domain_agents: { files: ['agents/'], spec: null, dependsOn: [] },
    domain_common: { files: ['CLAUDE.md', 'package.json'], spec: null, dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  assert.ok(!suggestions.some(s => s.from === 'domain_agents' && s.to === 'domain_common'));
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges excludes self-loops', () => {
  const root = makeTmpDir();
  writeFile(root, 'docs/a.md', 'This mentions domain_a itself, which should never be suggested.');
  writeIndex(root, {
    $schema: './x',
    domain_a: { files: [], spec: 'docs/a.md', dependsOn: [] },
  });

  const suggestions = suggestEdges(root);
  assert.ok(!suggestions.some(s => s.from === 'domain_a' && s.to === 'domain_a'));
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges returns [] when no ontology directory can be resolved', () => {
  const root = makeTmpDir();
  const suggestions = suggestEdges(root);
  assert.deepStrictEqual(suggestions, []);
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges is deterministic (sorted, stable across repeated calls)', () => {
  const root = makeTmpDir();
  writeFile(root, 'docs/a.md', 'domain_b and domain_c both matter here.');
  writeIndex(root, {
    $schema: './x',
    domain_a: { files: [], spec: 'docs/a.md', dependsOn: [] },
    domain_b: { files: [], spec: null, dependsOn: [] },
    domain_c: { files: [], spec: null, dependsOn: [] },
  });

  const first = suggestEdges(root);
  const second = suggestEdges(root);
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first.map(s => s.to), ['domain_b', 'domain_c']);
  fs.rmSync(root, { recursive: true });
});

run('suggestEdges works on the real project without throwing', () => {
  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const indexPath = path.join(REPO_ROOT, '.claude', 'ontology', 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.log('    (skipped — index.json not found)');
    return;
  }
  const suggestions = suggestEdges(REPO_ROOT);
  assert.ok(Array.isArray(suggestions));
  for (const s of suggestions) {
    assert.ok(s.from && s.to && Array.isArray(s.evidence) && s.evidence.length > 0);
    assert.notStrictEqual(s.from, s.to);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
