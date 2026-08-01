'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  computeCorpusHash,
  computeTreeHash,
  listFixtureIds,
  prepareEpisode,
  readFixture,
} = require('../../scripts/lib/benchmark-fixtures');
const { validateMetadata, KNOWN_STRATA } = require('../../scripts/validate-benchmark-fixtures');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-fixture-test-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runVerifier(cwd) {
  return spawnSync(process.execPath, ['../verify.js'], {
    cwd, shell: false, timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const ids = listFixtureIds();

console.log('benchmark-fixtures');

test('corpus is non-empty and every fixture is readable', () => {
  assert.ok(ids.length > 0, 'no fixtures found');
  for (const id of ids) {
    const fixture = readFixture(id);
    assert.strictEqual(fixture.metadata.id, id);
    assert.match(fixture.snapshotHash, /^sha256:[a-f0-9]{64}$/);
  }
});

test('every fixture carries valid, publishable metadata', () => {
  for (const id of ids) {
    const errors = validateMetadata(readFixture(id).metadata);
    assert.deepStrictEqual(errors, [], `${id}: ${errors.join('; ')}`);
  }
});

test('every fixture declares a known stratum', () => {
  for (const id of ids) {
    assert.ok(KNOWN_STRATA.has(readFixture(id).metadata.stratum), `${id} has an unknown stratum`);
  }
});

test('no verifier is reachable from the agent workspace', () => {
  // The hidden-verifier property is what stops the agent editing its own grader.
  for (const id of ids) {
    assert.ok(!fs.existsSync(path.join(readFixture(id).workspaceDir, 'verify.js')), `${id} exposes verify.js`);
  }
});

test('tree hash is path-independent and content-sensitive', () => {
  withTempRoot(root => {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    for (const dir of [a, b]) {
      fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'top.txt'), 'same');
      fs.writeFileSync(path.join(dir, 'nested', 'file.txt'), 'same');
    }
    assert.strictEqual(computeTreeHash(a), computeTreeHash(b));

    fs.writeFileSync(path.join(b, 'nested', 'file.txt'), 'different');
    assert.notStrictEqual(computeTreeHash(a), computeTreeHash(b));
  });
});

test('corpus hash is stable and covers verifier content', () => {
  assert.strictEqual(computeCorpusHash(), computeCorpusHash());
  assert.match(computeCorpusHash(), /^sha256:[a-f0-9]{64}$/);
});

test('prepareEpisode places the verifier outside the agent cwd', () => {
  withTempRoot(root => {
    const episode = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'ep') });
    assert.strictEqual(path.basename(episode.cwd), 'workspace');
    assert.strictEqual(path.dirname(episode.verifierPath), path.dirname(episode.cwd));
    assert.ok(!fs.existsSync(path.join(episode.cwd, 'verify.js')));
    assert.ok(fs.existsSync(episode.verifierPath));
  });
});

test('prepareEpisode refuses to reuse a directory', () => {
  withTempRoot(root => {
    const episodeRoot = path.join(root, 'ep');
    prepareEpisode({ taskId: ids[0], episodeRoot });
    // Reuse would let one episode observe another's edits.
    assert.throws(() => prepareEpisode({ taskId: ids[0], episodeRoot }), /already exists/);
  });
});

test('reference overlay does not change the reported snapshot hash', () => {
  withTempRoot(root => {
    const baseline = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'base') });
    const reference = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'ref'), applyReference: true });
    assert.strictEqual(reference.snapshotHash, baseline.snapshotHash);
    // But the materialized trees must actually differ.
    assert.notStrictEqual(computeTreeHash(reference.cwd), computeTreeHash(baseline.cwd));
  });
});

test('rejects an unsafe task id', () => {
  assert.throws(() => readFixture('../etc'), /Invalid fixture task id/);
  assert.throws(() => readFixture('a'), /Invalid fixture task id/);
});

test('every fixture fails at baseline and passes with its reference fix', () => {
  // This is the ceiling-effect guard: a task that already passes measures nothing.
  withTempRoot(root => {
    for (const id of ids) {
      const baseline = prepareEpisode({ taskId: id, episodeRoot: path.join(root, `${id}-base`) });
      assert.notStrictEqual(runVerifier(baseline.cwd).status, 0, `${id} passes on a clean checkout`);

      const reference = prepareEpisode({ taskId: id, episodeRoot: path.join(root, `${id}-ref`), applyReference: true });
      assert.strictEqual(runVerifier(reference.cwd).status, 0, `${id} reference fix does not satisfy the verifier`);
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
