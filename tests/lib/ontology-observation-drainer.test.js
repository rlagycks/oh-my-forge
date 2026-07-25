'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStateStore } = require('../../scripts/lib/state-store');
const {
  drainOntologyObservationSpool,
  readOntologyObservationSpoolSlice,
  validateOntologyObservation,
} = require('../../scripts/lib/ontology-observation-drainer');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS ${name}`));
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-drainer-'));
  const sourcePath = path.join(root, 'src', 'example.js');
  const logPath = path.join(root, 'observations.jsonl');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'ontology'), { recursive: true });
  fs.writeFileSync(sourcePath, 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, '.claude', 'ontology', 'index.json'), JSON.stringify({
    domain_example: {
      summary: 'example',
      files: ['src/'],
      spec: 'docs/features/example.md',
      owner: 'test',
    },
  }), 'utf8');
  return { root, sourcePath, logPath };
}

function observation(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'ontology-observation-1234567890abcdef12345678',
    eventType: 'file_changed',
    sessionId: 'session-1',
    projectRoot: fixture.root,
    domainKey: 'domain_example',
    filePath: 'src/example.js',
    contentFingerprint: sha256(fs.readFileSync(fixture.sourcePath)),
    observedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

async function main() {
  console.log('\nontology-observation-drainer.test.js');

  await test('validates a metadata-only observation and rejects unsafe source fields', () => {
    const fixture = makeFixture();
    try {
      assert.strictEqual(validateOntologyObservation(observation(fixture)).valid, true);
      const rejected = validateOntologyObservation(observation(fixture, {
        filePath: '../secret.txt',
        content: 'do not retain this source content',
      }));
      assert.strictEqual(rejected.valid, false);
      assert.ok(rejected.errors.some(error => error.includes('filePath')));
      assert.ok(rejected.errors.some(error => error.includes('content')));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('reads complete newline records without consuming an EOF partial line', () => {
    const fixture = makeFixture();
    try {
      const first = JSON.stringify(observation(fixture));
      const second = JSON.stringify(observation(fixture, { id: 'ontology-observation-bbbbbbbbbbbbbbbbbbbbbbbb' }));
      fs.writeFileSync(fixture.logPath, `${first}\n${second}`, 'utf8');
      const slice = readOntologyObservationSpoolSlice(fixture.logPath, { offset: 0 });
      assert.strictEqual(slice.entries.length, 1);
      assert.strictEqual(slice.nextOffset, Buffer.byteLength(`${first}\n`));
      assert.strictEqual(slice.truncated, true);

      fs.appendFileSync(fixture.logPath, '\n', 'utf8');
      const resumed = readOntologyObservationSpoolSlice(fixture.logPath, { offset: slice.nextOffset });
      assert.strictEqual(resumed.entries.length, 1);
      assert.strictEqual(resumed.entries[0].observation.id, 'ontology-observation-bbbbbbbbbbbbbbbbbbbbbbbb');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('drains candidates transactionally, records evidence, and preserves source files', async () => {
    const fixture = makeFixture();
    const store = await createStateStore({ dbPath: ':memory:' });
    const beforeIndex = fs.readFileSync(path.join(fixture.root, '.claude', 'ontology', 'index.json'));
    const beforeSource = fs.readFileSync(fixture.sourcePath);
    try {
      fs.writeFileSync(fixture.logPath, `${JSON.stringify(observation(fixture))}\n`, 'utf8');
      const result = await drainOntologyObservationSpool({ logPath: fixture.logPath, stateStore: store });
      assert.deepStrictEqual(result, {
        status: 'drained', created: 1, updated: 0, duplicates: 0, rejected: 0,
        checkpointOffset: fs.statSync(fixture.logPath).size,
      });
      const candidates = store.listOntologyCandidates({ projectRoot: fixture.root });
      assert.strictEqual(candidates.totalCount, 1);
      assert.strictEqual(candidates.candidates[0].status, 'pending_review');
      assert.strictEqual(candidates.candidates[0].observationCount, 1);
      assert.strictEqual(store.listOntologyCandidateEvidence(candidates.candidates[0].id).length, 1);
      assert.deepStrictEqual(fs.readFileSync(path.join(fixture.root, '.claude', 'ontology', 'index.json')), beforeIndex);
      assert.deepStrictEqual(fs.readFileSync(fixture.sourcePath), beforeSource);

      const replay = await drainOntologyObservationSpool({ logPath: fixture.logPath, stateStore: store });
      assert.strictEqual(replay.duplicates, 0);
      assert.strictEqual(store.listOntologyCandidates({ projectRoot: fixture.root }).candidates[0].observationCount, 1);

      fs.writeFileSync(fixture.sourcePath, 'module.exports = 2;\n', 'utf8');
      fs.appendFileSync(fixture.logPath, `${JSON.stringify(observation(fixture, {
        id: 'ontology-observation-bbbbbbbbbbbbbbbbbbbbbbbb',
        observedAt: '2026-07-25T01:00:00.000Z',
      }))}\n`, 'utf8');
      const update = await drainOntologyObservationSpool({ logPath: fixture.logPath, stateStore: store });
      assert.strictEqual(update.updated, 1);
      const updated = store.listOntologyCandidates({ projectRoot: fixture.root }).candidates[0];
      assert.strictEqual(updated.observationCount, 2);
      assert.strictEqual(updated.lastObservedAt, '2026-07-25T01:00:00.000Z');
      assert.strictEqual(store.listOntologyCandidateEvidence(updated.id).length, 2);
    } finally {
      store.close();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('does not open the store or advance the cursor while another drainer owns the lock', async () => {
    const fixture = makeFixture();
    const store = await createStateStore({ dbPath: ':memory:' });
    const lockPath = `${fixture.logPath}.drain.lock`;
    try {
      fs.writeFileSync(fixture.logPath, `${JSON.stringify(observation(fixture))}\n`, 'utf8');
      fs.writeFileSync(lockPath, 'busy', 'utf8');
      const result = await drainOntologyObservationSpool({ logPath: fixture.logPath, stateStore: store });
      assert.strictEqual(result.status, 'locked');
      assert.strictEqual(store.getOntologyObservationCursor(fixture.logPath), null);
      assert.strictEqual(fs.readFileSync(fixture.logPath, 'utf8').split('\n').filter(Boolean).length, 1);
    } finally {
      store.close();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('applies the ontology candidate migration only once when reopening a state store', async () => {
    const fixture = makeFixture();
    const dbPath = path.join(fixture.root, 'state.db');
    try {
      const first = await createStateStore({ dbPath });
      assert.deepStrictEqual(first.getAppliedMigrations().map(migration => migration.version), [1, 2, 3]);
      first.close();
      const reopened = await createStateStore({ dbPath });
      assert.deepStrictEqual(reopened.getAppliedMigrations().map(migration => migration.version), [1, 2, 3]);
      reopened.close();
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
