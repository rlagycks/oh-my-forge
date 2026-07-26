'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStateStore } = require('../../scripts/lib/state-store');
const {
  WORKFLOW_LOCK_TTL_MS,
  acquireWorkflowLock,
  lockPathFor,
  readWorkflowLockMetadata,
  resolveCommandPaths,
} = require('../../scripts/ontology-maintain');

const NOW_MS = Date.parse('2026-07-27T00:00:00.000Z');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-ontology-maintain-lock-'));
  return { root, dbPath: path.join(root, 'state.db') };
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function writeLock(dbPath, metadata) {
  fs.writeFileSync(lockPathFor(dbPath), `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
}

function lockMetadata(pid, createdAt, ownerToken) {
  return { pid, createdAt, ownerToken };
}

async function main() {
  console.log('\nontology-maintain-lock.test.js');
  const fixture = createFixture();
  try {
    const writableStore = await createStateStore({ dbPath: fixture.dbPath });
    writableStore.close();
    const beforeReadOnly = fs.readFileSync(fixture.dbPath);
    const readOnlyStore = await createStateStore({ dbPath: fixture.dbPath, readOnly: true });
    assert.strictEqual(readOnlyStore.readOnly, true);
    assert.throws(() => readOnlyStore._database.exec('CREATE TABLE rejected (id INTEGER)'));
    readOnlyStore.close();
    assert.deepStrictEqual(fs.readFileSync(fixture.dbPath), beforeReadOnly);

    const sharedDirectory = path.join(fixture.root, 'shared');
    const nestedDirectory = path.join(sharedDirectory, 'state');
    fs.mkdirSync(nestedDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(sharedDirectory, 0o777);
    assert.throws(
      () => resolveCommandPaths({ repo: fixture.root, db: path.join(nestedDirectory, 'state.db') }),
      /directory path must be private/
    );
    fs.chmodSync(sharedDirectory, 0o700);

    writeLock(fixture.dbPath, lockMetadata(4242, new Date(NOW_MS).toISOString(), 'a'.repeat(32)));
    const reclaimCrash = acquireWorkflowLock(fixture.dbPath, {
      nowMs: NOW_MS + 1, pid: 1001, isPidAlive: pid => pid !== 4242,
    });
    assert.strictEqual(typeof reclaimCrash, 'function');
    const reclaimedMetadata = readWorkflowLockMetadata(lockPathFor(fixture.dbPath));
    assert.strictEqual(reclaimedMetadata.pid, 1001);
    assert.strictEqual(reclaimedMetadata.createdAt, new Date(NOW_MS + 1).toISOString());
    assert.match(reclaimedMetadata.ownerToken, /^[a-f0-9]{32}$/);
    reclaimCrash();
    assert.strictEqual(fs.existsSync(lockPathFor(fixture.dbPath)), false);

    writeLock(fixture.dbPath, lockMetadata(4243, new Date(NOW_MS - WORKFLOW_LOCK_TTL_MS).toISOString(), 'b'.repeat(32)));
    const reclaimTtl = acquireWorkflowLock(fixture.dbPath, {
      nowMs: NOW_MS, pid: 1002, isPidAlive: () => true,
    });
    assert.strictEqual(typeof reclaimTtl, 'function');
    reclaimTtl();

    writeLock(fixture.dbPath, lockMetadata(4244, new Date(NOW_MS + 60 * 1000 + 1).toISOString(), 'c'.repeat(32)));
    const reclaimFuture = acquireWorkflowLock(fixture.dbPath, {
      nowMs: NOW_MS, pid: 1003, isPidAlive: () => true,
    });
    assert.strictEqual(typeof reclaimFuture, 'function');
    reclaimFuture();

    const releaseOriginal = acquireWorkflowLock(fixture.dbPath, {
      nowMs: NOW_MS, pid: 1004, isPidAlive: () => true,
      beforeReleaseUnlink: () => {
        fs.unlinkSync(lockPathFor(fixture.dbPath));
        writeLock(fixture.dbPath, lockMetadata(1005, new Date(NOW_MS).toISOString(), 'd'.repeat(32)));
      },
    });
    assert.strictEqual(typeof releaseOriginal, 'function');
    releaseOriginal();
    assert.deepStrictEqual(readWorkflowLockMetadata(lockPathFor(fixture.dbPath)), {
      pid: 1005, createdAt: new Date(NOW_MS).toISOString(), ownerToken: 'd'.repeat(32),
    });
    fs.unlinkSync(lockPathFor(fixture.dbPath));

    writeLock(fixture.dbPath, { pid: 4245, createdAt: new Date(NOW_MS - WORKFLOW_LOCK_TTL_MS).toISOString() });
    assert.strictEqual(acquireWorkflowLock(fixture.dbPath, {
      nowMs: NOW_MS, pid: 1006, isPidAlive: () => false,
    }), null, 'legacy locks without an owner token require explicit operator recovery');
    fs.unlinkSync(lockPathFor(fixture.dbPath));
    console.log('  PASS reclaims crash and TTL stale locks without deleting a replacement lock');
  } finally {
    cleanup(fixture);
  }
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
