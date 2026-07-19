'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseInstinctFrontmatter,
  loadInstinctsFromDir,
  findProjectInstinctsDir,
  mergeInstincts,
  selectTopInstincts,
  buildInstinctsContext,
  collectInstinctContext,
  loadInstinctsForDomain,
  isVerifiedExperience,
  selectRelevantInstincts,
} = require('../../scripts/lib/instinct-loader');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeInstinct(filePath, frontmatterLines, body = '') {
  mkdirp(path.dirname(filePath));
  const content = ['---', ...frontmatterLines, '---', body].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

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

console.log('\n=== Testing instinct-loader ===\n');

run('parseInstinctFrontmatter: parses id/trigger/confidence/outcome and quoted values', () => {
  const content = [
    '---',
    'id: prefer-functional-style',
    'trigger: "when writing new functions"',
    'confidence: 0.7',
    'outcome: failure',
    '---',
    '',
    '# Prefer Functional Style',
    '',
    '## Action',
    'Use functional patterns.',
  ].join('\n');

  const parsed = parseInstinctFrontmatter(content);
  assert.strictEqual(parsed.id, 'prefer-functional-style');
  assert.strictEqual(parsed.trigger, 'when writing new functions');
  assert.strictEqual(parsed.confidence, '0.7');
  assert.strictEqual(parsed.outcome, 'failure');
  assert.strictEqual(parsed.title, 'Prefer Functional Style');
});

run('parseInstinctFrontmatter: returns null when no frontmatter block is present', () => {
  assert.strictEqual(parseInstinctFrontmatter('# just a heading\nno frontmatter here'), null);
});

run('loadInstinctsFromDir: skips malformed files (missing id, non-numeric confidence)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-instincts-'));
  try {
    writeInstinct(path.join(tmpRoot, 'good.yaml'), [
      'id: good-instinct',
      'trigger: "do the thing"',
      'confidence: 0.8',
      'outcome: failure',
    ]);
    writeInstinct(path.join(tmpRoot, 'no-id.yaml'), [
      'trigger: "missing id"',
      'confidence: 0.9',
    ]);
    writeInstinct(path.join(tmpRoot, 'bad-confidence.yaml'), [
      'id: bad-confidence',
      'trigger: "nan confidence"',
      'confidence: not-a-number',
    ]);
    fs.writeFileSync(path.join(tmpRoot, 'ignored.txt'), 'id: not-yaml\n', 'utf8');

    const instincts = loadInstinctsFromDir(tmpRoot);
    assert.strictEqual(instincts.length, 1);
    assert.strictEqual(instincts[0].id, 'good-instinct');
    assert.strictEqual(instincts[0].confidence, 0.8);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

run('loadInstinctsFromDir: returns [] for a missing directory', () => {
  assert.deepStrictEqual(loadInstinctsFromDir(null), []);
  assert.deepStrictEqual(loadInstinctsFromDir(path.join(os.tmpdir(), 'does-not-exist-xyz')), []);
});

run('mergeInstincts: project-scoped instincts override global ones on id collision', () => {
  const merged = mergeInstincts(
    [{ id: 'shared', confidence: 0.5, outcome: '', trigger: 'global', title: '' }],
    [{ id: 'shared', confidence: 0.9, outcome: 'failure', trigger: 'project', title: '' }]
  );
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].trigger, 'project');
  assert.strictEqual(merged[0].confidence, 0.9);
});

run('selectTopInstincts: filters below the confidence threshold', () => {
  const instincts = [
    { id: 'low', confidence: 0.5, outcome: '', trigger: 't', title: '' },
    { id: 'high', confidence: 0.75, outcome: '', trigger: 't', title: '' },
  ];
  const selected = selectTopInstincts(instincts);
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].id, 'high');
});

run('selectTopInstincts: caps at 5 and surfaces failure-outcome instincts first', () => {
  const instincts = Array.from({ length: 8 }, (_, i) => ({
    id: `inst-${i}`,
    confidence: 0.7 + i * 0.01,
    outcome: i === 2 ? 'failure' : '',
    trigger: `trigger-${i}`,
    title: '',
  }));

  const selected = selectTopInstincts(instincts);
  assert.strictEqual(selected.length, 5);
  assert.strictEqual(selected[0].id, 'inst-2', 'the failure-outcome instinct should be surfaced first');
  assert.ok(selected[0].outcome === 'failure');
});

run('buildInstinctsContext: renders header + one line per instinct, prefers title over id', () => {
  const context = buildInstinctsContext([
    { id: 'inst-a', confidence: 0.9, outcome: 'failure', trigger: 'do X', title: 'Instinct A' },
    { id: 'inst-b', confidence: 0.8, outcome: '', trigger: 'do Y', title: '' },
  ]);
  assert.match(context, /^Learned instincts \(top 5, confidence/);
  assert.ok(context.includes('- [failure] do X: Instinct A'), context);
  assert.ok(context.includes('- [general] do Y: inst-b'), context);
});

run('buildInstinctsContext: returns empty string for an empty list', () => {
  assert.strictEqual(buildInstinctsContext([]), '');
});

run('buildInstinctsContext: keeps the whole block under the ~600 char cap', () => {
  const longTrigger = 'x'.repeat(120);
  const instincts = Array.from({ length: 5 }, (_, i) => ({
    id: `inst-${i}`,
    confidence: 0.9,
    outcome: 'failure',
    trigger: longTrigger,
    title: '',
  }));
  const context = buildInstinctsContext(instincts);
  assert.ok(context.length <= 700, `expected roughly capped output, got ${context.length} chars`);
});

run('findProjectInstinctsDir: matches a registered project root (exact and subdirectory)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-project-'));
  const originalHomedir = os.homedir;

  try {
    writeJson(path.join(tmpHome, '.claude', 'homunculus', 'projects.json'), {
      abc123: { id: 'abc123', name: 'demo', root: projectRoot },
    });
    os.homedir = () => tmpHome;

    const exactDir = findProjectInstinctsDir(projectRoot);
    assert.strictEqual(
      exactDir,
      path.join(tmpHome, '.claude', 'homunculus', 'projects', 'abc123', 'instincts', 'personal')
    );

    const subDir = path.join(projectRoot, 'packages', 'app');
    mkdirp(subDir);
    assert.strictEqual(findProjectInstinctsDir(subDir), exactDir);

    assert.strictEqual(findProjectInstinctsDir(fs.mkdtempSync(path.join(os.tmpdir(), 'unrelated-'))), null);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('findProjectInstinctsDir: returns null when the registry is missing or malformed', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => tmpHome;
    assert.strictEqual(findProjectInstinctsDir(process.cwd()), null);

    mkdirp(path.join(tmpHome, '.claude', 'homunculus'));
    fs.writeFileSync(path.join(tmpHome, '.claude', 'homunculus', 'projects.json'), 'not json', 'utf8');
    assert.strictEqual(findProjectInstinctsDir(process.cwd()), null);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('collectInstinctContext: merges global + project instincts (project wins) and renders context', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-project-'));
  const originalHomedir = os.homedir;

  try {
    writeJson(path.join(tmpHome, '.claude', 'homunculus', 'projects.json'), {
      abc123: { id: 'abc123', name: 'demo', root: projectRoot },
    });
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'shared.yaml'),
      ['id: shared-instinct', 'trigger: "global trigger"', 'confidence: 0.8']
    );
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'weak.yaml'),
      ['id: weak-instinct', 'trigger: "rarely useful"', 'confidence: 0.4']
    );
    writeInstinct(
      path.join(
        tmpHome, '.claude', 'homunculus', 'projects', 'abc123', 'instincts', 'personal', 'shared.yaml'
      ),
      ['id: shared-instinct', 'trigger: "project trigger"', 'confidence: 0.9', 'outcome: failure']
    );
    os.homedir = () => tmpHome;

    const { instincts, context } = collectInstinctContext(projectRoot);
    assert.strictEqual(instincts.length, 1, JSON.stringify(instincts));
    assert.strictEqual(instincts[0].id, 'shared-instinct');
    assert.strictEqual(instincts[0].trigger, 'project trigger', 'project instinct should win on id collision');
    assert.match(context, /^Learned instincts \(top 5, confidence/);
    assert.ok(context.includes('- [failure] project trigger: shared-instinct'), context);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('collectInstinctContext: returns empty context when nothing qualifies', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => tmpHome;
    const { instincts, context } = collectInstinctContext(process.cwd());
    assert.deepStrictEqual(instincts, []);
    assert.strictEqual(context, '');
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('loadInstinctsFromDir: exposes linked_domain frontmatter as linkedDomain (empty string when absent)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-linked-'));
  try {
    writeInstinct(path.join(tmpRoot, 'linked.yaml'), [
      'id: linked-instinct',
      'trigger: "editing hooks"',
      'confidence: 0.8',
      'linked_domain: domain_hooks',
    ]);
    writeInstinct(path.join(tmpRoot, 'unlinked.yaml'), [
      'id: unlinked-instinct',
      'trigger: "anything"',
      'confidence: 0.8',
    ]);

    const instincts = loadInstinctsFromDir(tmpRoot);
    const linked = instincts.find(instinct => instinct.id === 'linked-instinct');
    const unlinked = instincts.find(instinct => instinct.id === 'unlinked-instinct');
    assert.strictEqual(linked.linkedDomain, 'domain_hooks');
    assert.strictEqual(unlinked.linkedDomain, '');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

run('loadInstinctsForDomain: returns only instincts whose linked_domain matches the domain key', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const originalHomedir = os.homedir;
  try {
    const personalDir = path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal');
    writeInstinct(path.join(personalDir, 'a.yaml'), [
      'id: inst-a',
      'trigger: "touching domain_a files"',
      'confidence: 0.9',
      'outcome: failure',
      'linked_domain: domain_a',
    ]);
    writeInstinct(path.join(personalDir, 'b.yaml'), [
      'id: inst-b',
      'trigger: "touching domain_b files"',
      'confidence: 0.9',
      'linked_domain: domain_b',
    ]);
    writeInstinct(path.join(personalDir, 'none.yaml'), [
      'id: inst-none',
      'trigger: "no linked domain"',
      'confidence: 0.9',
    ]);
    os.homedir = () => tmpHome;

    const forA = loadInstinctsForDomain('domain_a', process.cwd());
    assert.strictEqual(forA.length, 1);
    assert.strictEqual(forA[0].id, 'inst-a');

    assert.deepStrictEqual(loadInstinctsForDomain('domain_missing', process.cwd()), []);
    assert.deepStrictEqual(loadInstinctsForDomain('', process.cwd()), []);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('loadInstinctsForDomain: merges project-scoped instincts (project wins on id collision)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-project-'));
  const originalHomedir = os.homedir;
  try {
    writeJson(path.join(tmpHome, '.claude', 'homunculus', 'projects.json'), {
      abc123: { id: 'abc123', name: 'demo', root: projectRoot },
    });
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal', 'shared.yaml'),
      ['id: shared', 'trigger: "global trigger"', 'confidence: 0.8', 'linked_domain: domain_a']
    );
    writeInstinct(
      path.join(tmpHome, '.claude', 'homunculus', 'projects', 'abc123', 'instincts', 'personal', 'shared.yaml'),
      ['id: shared', 'trigger: "project trigger"', 'confidence: 0.9', 'linked_domain: domain_a']
    );
    os.homedir = () => tmpHome;

    const instincts = loadInstinctsForDomain('domain_a', projectRoot);
    assert.strictEqual(instincts.length, 1);
    assert.strictEqual(instincts[0].trigger, 'project trigger');
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('loadInstinctsForDomain: composes with selectTopInstincts for the injection cap', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'instinct-loader-home-'));
  const originalHomedir = os.homedir;
  try {
    const personalDir = path.join(tmpHome, '.claude', 'homunculus', 'instincts', 'personal');
    for (let i = 0; i < 4; i++) {
      writeInstinct(path.join(personalDir, `inst-${i}.yaml`), [
        `id: inst-${i}`,
        `trigger: "trigger ${i}"`,
        `confidence: 0.${75 + i}`,
        `outcome: ${i === 3 ? 'failure' : 'success'}`,
        'linked_domain: domain_a',
      ]);
    }
    os.homedir = () => tmpHome;

    const selected = selectTopInstincts(loadInstinctsForDomain('domain_a', process.cwd()), { cap: 2 });
    assert.strictEqual(selected.length, 2);
    assert.strictEqual(selected[0].id, 'inst-3', 'failure-outcome instinct should come first');
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

run('isVerifiedExperience: requires two evidence records, validation, and a non-expired lifetime', () => {
  const now = new Date('2026-07-19T00:00:00.000Z');
  assert.strictEqual(isVerifiedExperience({
    id: 'verified', status: 'validated', evidenceCount: 2, evidenceIds: ['replay-a', 'replay-b'], lastValidated: '2026-07-18T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
  }, now), true);
  assert.strictEqual(isVerifiedExperience({
    id: 'single-proof', status: 'validated', evidenceCount: 1, evidenceIds: ['replay-a'], lastValidated: '2026-07-18T00:00:00.000Z',
  }, now), false);
  assert.strictEqual(isVerifiedExperience({
    id: 'duplicate-proof', status: 'validated', evidenceCount: 2, evidenceIds: ['replay-a', 'replay-a'], lastValidated: '2026-07-18T00:00:00.000Z',
  }, now), false);
  assert.strictEqual(isVerifiedExperience({
    id: 'expired', status: 'validated', evidenceCount: 3, evidenceIds: ['replay-a', 'replay-b', 'replay-c'], lastValidated: '2026-07-18T00:00:00.000Z',
    expiresAt: '2026-07-18T23:59:59.000Z',
  }, now), false);
});

run('selectRelevantInstincts: uses task terms, verified evidence, and a hard context budget', () => {
  const now = new Date('2026-07-19T00:00:00.000Z');
  const selected = selectRelevantInstincts([
    {
      id: 'auth-verified', trigger: 'validate authentication token before API request', title: 'Auth boundary',
      confidence: 0.72, status: 'validated', evidenceCount: 2, evidenceIds: ['replay-a', 'replay-b'], lastValidated: '2026-07-18T00:00:00.000Z',
    },
    {
      id: 'unverified-high-confidence', trigger: 'authentication API shortcut', title: 'Unsafe candidate',
      confidence: 0.99, status: 'candidate', evidenceCount: 0,
    },
    {
      id: 'unrelated', trigger: 'format markdown table', title: 'Docs',
      confidence: 0.95, status: 'validated', evidenceCount: 3, evidenceIds: ['replay-a', 'replay-b', 'replay-c'], lastValidated: '2026-07-18T00:00:00.000Z',
    },
  ], {
    query: 'fix API authentication request',
    cap: 2,
    maxChars: 110,
    now,
    requireVerified: true,
  });

  assert.deepStrictEqual(selected.map(instinct => instinct.id), ['auth-verified']);
  assert.ok(selected.every(instinct => instinct.renderedLength <= 110));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
