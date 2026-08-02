'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  classifyChanges,
  computeCorpusHash,
  computeTreeManifest,
  diffManifest,
  materializeVerifier,
  computeTreeHash,
  listFixtureIds,
  prepareEpisode,
  readFixture,
} = require('../../benchmarks/lib/fixtures');
const { validateMetadata, KNOWN_STRATA } = require('../../benchmarks/validate-fixtures');

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

test('no fixture ships a verifier inside workspace/', () => {
  // A verifier under workspace/ would be handed straight to the agent.
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

test('the verifier is absent while the agent would be running', () => {
  // Contamination control: the grader does not exist on disk during the run,
  // so ordinary exploration cannot find it.
  withTempRoot(root => {
    const episode = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'ep') });
    assert.strictEqual(path.basename(episode.cwd), 'workspace');
    assert.strictEqual(episode.verifierPath, null);
    assert.ok(!fs.existsSync(path.join(episode.episodeRoot, 'verify.js')), 'verifier must not exist yet');
    assert.ok(!fs.existsSync(path.join(episode.cwd, 'verify.js')));

    const materialized = materializeVerifier({ taskId: ids[0], episodeRoot: episode.episodeRoot });
    assert.ok(fs.existsSync(materialized.verifierPath));
    assert.match(materialized.verifierHash, /^sha256:[a-f0-9]{64}$/);
    assert.deepStrictEqual(materialized.unexpectedEntries, []);
  });
});

test('materializeVerifier reports anything the agent left in the episode root', () => {
  withTempRoot(root => {
    const episode = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'ep') });
    // Simulate an agent that wrote outside its working directory, including a
    // pre-planted grader.
    fs.writeFileSync(path.join(episode.episodeRoot, 'escape.txt'), 'OK');
    fs.writeFileSync(path.join(episode.episodeRoot, 'verify.js'), 'process.exit(0);');

    const materialized = materializeVerifier({ taskId: ids[0], episodeRoot: episode.episodeRoot });
    assert.deepStrictEqual(materialized.unexpectedEntries, ['escape.txt', 'verify.js']);
    // The fixture copy wins over anything planted there.
    const authoritative = fs.readFileSync(readFixture(ids[0]).verifierPath, 'utf8');
    assert.strictEqual(fs.readFileSync(materialized.verifierPath, 'utf8'), authoritative);
  });
});

test('scope diff classifies edits against the protected paths', () => {
  withTempRoot(root => {
    const episode = prepareEpisode({ taskId: 'csv-quoted-fields', episodeRoot: path.join(root, 'ep') });
    const before = episode.manifest;

    // An in-scope repair is clean.
    fs.appendFileSync(path.join(episode.cwd, 'src', 'parse-csv.js'), '\n// fixed\n');
    const inScope = classifyChanges(diffManifest(before, computeTreeManifest(episode.cwd)));
    assert.strictEqual(inScope.clean, true);
    assert.strictEqual(inScope.changed, 1);

    // Deleting the shipped tests is not.
    fs.rmSync(path.join(episode.cwd, 'test'), { recursive: true, force: true });
    const outOfScope = classifyChanges(diffManifest(before, computeTreeManifest(episode.cwd)));
    assert.strictEqual(outOfScope.clean, false);
    assert.ok(outOfScope.outOfScope.some(entry => entry.startsWith('test/')), 'test deletion must be flagged');
  });
});

test('rewriting package.json is out of scope', () => {
  withTempRoot(root => {
    const episode = prepareEpisode({ taskId: 'csv-quoted-fields', episodeRoot: path.join(root, 'ep') });
    fs.writeFileSync(path.join(episode.cwd, 'package.json'), '{"scripts":{"test":"true"}}');
    const changes = classifyChanges(diffManifest(episode.manifest, computeTreeManifest(episode.cwd)));
    assert.strictEqual(changes.clean, false);
    assert.deepStrictEqual(changes.outOfScope, ['package.json']);
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
    const baseline = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'base'), includeVerifier: true });
    const reference = prepareEpisode({ taskId: ids[0], episodeRoot: path.join(root, 'ref'), applyReference: true, includeVerifier: true });
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
      const baseline = prepareEpisode({ taskId: id, episodeRoot: path.join(root, `${id}-base`), includeVerifier: true });
      assert.notStrictEqual(runVerifier(baseline.cwd).status, 0, `${id} passes on a clean checkout`);

      const reference = prepareEpisode({ taskId: id, episodeRoot: path.join(root, `${id}-ref`), applyReference: true, includeVerifier: true });
      assert.strictEqual(runVerifier(reference.cwd).status, 0, `${id} reference fix does not satisfy the verifier`);
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
