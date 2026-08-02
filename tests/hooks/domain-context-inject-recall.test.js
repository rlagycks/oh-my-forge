'use strict';

/**
 * Covers graph-recall changes to domain-context-inject.js:
 *
 *  B1 — domain-scoped instinct recall: instincts whose `linked_domain`
 *       frontmatter matches the touched domain are injected (max 2,
 *       failure-outcome first) under an "Instincts:" heading; zero output
 *       when none match.
 *  B2 — dependent-domain recall routed through ontology-blast-radius's
 *       traverseDependsOn(): the "Depends on:" line and per-dep key
 *       constraints keep the exact pre-refactor format.
 *  Instrumentation — each injection appends one JSONL line to
 *       ~/.claude/logs/recall-hits.jsonl with
 *       { ts, domain, kinds: {constraints, decisions, instincts}, chars }.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const domainContextInjectPath = path.resolve(__dirname, '../../scripts/hooks/domain-context-inject.js');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeInstinct(filePath, frontmatterLines, body = '') {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, ['---', ...frontmatterLines, '---', body].join('\n'), 'utf8');
}

/**
 * Instinct recall gates on `expires_at` being in the future, so a hard-coded
 * date turns this fixture into a time bomb: once it passes, the failure
 * instinct is filtered out and the test fails for every change, forever.
 * Anchor the expiry to the run instead.
 */
function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fixture: project with dependsOn chain domain_a -> domain_b -> domain_c and
 * a fake home dir holding instincts. Instincts for domain_a: one failure, two
 * others (to prove the max-2 cap); one instinct linked to domain_b that must
 * not leak into domain_a recall.
 */
function makeFixture({ withInstincts = true } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-recall-'));
  const projectRoot = path.join(tempRoot, 'project');
  const trackedFile = path.join(projectRoot, 'src', 'a.js');

  mkdirp(path.join(projectRoot, 'src'));
  fs.writeFileSync(trackedFile, 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'src', 'b.js'), '1;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'src', 'c.js'), '1;\n', 'utf8');

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_a: { summary: 'A', owner: 'team', files: ['src/a.js'], dependsOn: ['domain_b'], constraints: ['A must not do X'] },
    domain_b: { summary: 'B', owner: 'team', files: ['src/b.js'], dependsOn: ['domain_c'], constraints: ['B must not do Y'] },
    domain_c: { summary: 'C', owner: 'team', files: ['src/c.js'], dependsOn: [], constraints: ['C must not do Z'] },
  });

  const fakeHome = path.join(tempRoot, 'home');
  mkdirp(fakeHome);

  if (withInstincts) {
    const personalDir = path.join(fakeHome, '.claude', 'homunculus', 'instincts', 'personal');
    writeInstinct(path.join(personalDir, 'a-failure.yaml'), [
      'id: inst-a-failure',
      'trigger: "editing domain_a"',
      'confidence: 0.8',
      'outcome: failure',
      'linked_domain: domain_a',
      'status: validated',
      'evidence_count: 2',
      'evidence_ids: replay-a-failure-1,replay-a-failure-2',
      'last_validated: 2026-07-18T00:00:00.000Z',
      `expires_at: ${daysFromNow(30)}`,
    ], '\n# Watch the failure case\n');
    writeInstinct(path.join(personalDir, 'a-second.yaml'), [
      'id: inst-a-second',
      'trigger: "editing domain_a again"',
      'confidence: 0.95',
      'outcome: success',
      'linked_domain: domain_a',
      'status: validated',
      'evidence_count: 3',
      'evidence_ids: replay-a-second-1,replay-a-second-2,replay-a-second-3',
      'last_validated: 2026-07-18T00:00:00.000Z',
    ]);
    writeInstinct(path.join(personalDir, 'a-third.yaml'), [
      'id: inst-a-third',
      'trigger: "yet another domain_a lesson"',
      'confidence: 0.85',
      'outcome: success',
      'linked_domain: domain_a',
      'status: candidate',
      'evidence_count: 0',
    ]);
    writeInstinct(path.join(personalDir, 'b-only.yaml'), [
      'id: inst-b-only',
      'trigger: "editing domain_b"',
      'confidence: 0.99',
      'outcome: failure',
      'linked_domain: domain_b',
      'status: validated',
      'evidence_count: 2',
      'evidence_ids: replay-b-only-1,replay-b-only-2',
      'last_validated: 2026-07-18T00:00:00.000Z',
    ]);
  }

  return { tempRoot, projectRoot, trackedFile, fakeHome };
}

function makeInput(filePath) {
  return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });
}

function withCapturedStderr(fn) {
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderr = '';
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = originalWrite;
  }
  return stderr;
}

function freshRequire(modulePath) {
  // require.resolve follows symlinks the same way require() does, so the
  // cache eviction hits the module's actual cache key.
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

/**
 * Run the hook once inside a fixture: fake home, fresh session, captured
 * stderr. Returns the injected block. Caller cleans up the fixture.
 */
function runHookInFixture(fixture, sessionPrefix) {
  const originalCwd = process.cwd();
  const originalHomedir = os.homedir;
  process.chdir(fixture.projectRoot);
  os.homedir = () => fixture.fakeHome;
  process.env.CLAUDE_SESSION_ID = `${sessionPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const { run } = freshRequire(domainContextInjectPath);
    return withCapturedStderr(() => {
      run(makeInput(fixture.trackedFile));
    });
  } finally {
    process.chdir(originalCwd);
    os.homedir = originalHomedir;
    delete process.env.CLAUDE_SESSION_ID;
  }
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

console.log('\ndomain-context-inject-recall.test.js');

if (test('injects at most 2 domain-linked instincts, failure-outcome first, under an Instincts: heading', () => {
  const fixture = makeFixture();
  try {
    const stderr = runHookInFixture(fixture, 'recall-b1');

    assert.ok(stderr.includes('Instincts:'), stderr);
    const failureIndex = stderr.indexOf('[failure] editing domain_a: Watch the failure case');
    assert.ok(failureIndex !== -1, stderr);

    // Cap of 2: exactly one of the two success instincts joins the failure one.
    const successCount = ['inst-a-second', 'inst-a-third']
      .filter(id => stderr.includes(id)).length;
    assert.strictEqual(successCount, 1, `expected exactly 1 success instinct alongside the failure one:\n${stderr}`);

    // Failure-outcome first, despite lower confidence than the success ones.
    const secondIndex = stderr.indexOf('inst-a-second');
    assert.ok(secondIndex === -1 || failureIndex < secondIndex, 'failure instinct should be listed first');

    // No cross-domain leak.
    assert.ok(!stderr.includes('inst-b-only'), `domain_b instinct leaked into domain_a recall:\n${stderr}`);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('emits no Instincts: heading when no instinct links to the touched domain', () => {
  const fixture = makeFixture({ withInstincts: false });
  try {
    const stderr = runHookInFixture(fixture, 'recall-none');
    assert.ok(stderr.includes('[DOMAIN] domain_a'), stderr);
    assert.ok(!stderr.includes('Instincts:'), stderr);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('keeps the dependent-domain block format after the blast-radius traversal refactor', () => {
  const fixture = makeFixture({ withInstincts: false });
  try {
    const stderr = runHookInFixture(fixture, 'recall-b2');
    assert.ok(stderr.includes('Depends on: domain_b'), stderr);
    assert.ok(stderr.includes('[domain_b] key constraints:'), stderr);
    assert.ok(stderr.includes('- B must not do Y'), stderr);
    // Depth stays 1 for the constraint detail: domain_c (a 2-hop dep) must not appear.
    assert.ok(!stderr.includes('domain_c'), `2-hop dependency leaked into the injected block:\n${stderr}`);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

// --- Async: recall-hit JSONL instrumentation (fs.appendFile is fire-and-forget) ---

const logFixture = makeFixture();
const logStderr = runHookInFixture(logFixture, 'recall-log');

setTimeout(() => {
  if (test('appends one JSONL recall-hit line with {ts, domain, kinds, chars}', () => {
    const logPath = path.join(logFixture.fakeHome, '.claude', 'logs', 'recall-hits.jsonl');
    assert.ok(fs.existsSync(logPath), `expected recall log at ${logPath}`);

    const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    assert.strictEqual(logLines.length, 1, 'exactly one injection should log exactly one line');

    const hit = JSON.parse(logLines[0]);
    assert.ok(typeof hit.ts === 'string' && !Number.isNaN(Date.parse(hit.ts)), 'ts should be a parseable timestamp');
    assert.strictEqual(hit.domain, 'domain_a');
    assert.deepStrictEqual(Object.keys(hit.kinds).sort(), ['constraints', 'decisions', 'instincts']);
    assert.strictEqual(hit.kinds.constraints, 1);
    assert.strictEqual(hit.kinds.decisions, 0);
    assert.strictEqual(hit.kinds.instincts, 2);
    assert.deepStrictEqual(hit.payload.memory_ids.sort(), ['inst-a-failure', 'inst-a-second']);
    assert.ok(!JSON.stringify(hit).includes('editing domain_a'), 'experience text must not be persisted');
    assert.strictEqual(hit.chars, logStderr.length, 'chars should equal the injected block length');
  })) passed++; else failed++;

  fs.rmSync(logFixture.tempRoot, { recursive: true, force: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}, 250);
