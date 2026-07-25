'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStateStore } = require('../../scripts/lib/state-store');

const repoRoot = path.resolve(__dirname, '..', '..');
const runnerPath = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const maintenancePath = path.join(repoRoot, 'scripts', 'hooks', 'ontology-maintenance.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-maintenance-'));
  const sourcePath = path.join(root, 'src', 'example.js');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'ontology'), { recursive: true });
  fs.writeFileSync(sourcePath, 'module.exports = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, '.claude', 'ontology', 'index.json'), JSON.stringify({
    domain_example: { summary: 'example', files: ['src/'], spec: 'docs/features/example.md', owner: 'test' },
  }), 'utf8');
  return {
    root,
    sourcePath,
    homeDir: path.join(root, 'home'),
    logPath: path.join(root, 'observations.jsonl'),
  };
}

function test(name, fn) {
  return Promise.resolve().then(fn).then(() => console.log(`  PASS ${name}`));
}

async function main() {
  console.log('\nontology-maintenance.test.js');

  await test('drains observations automatically at lifecycle end without modifying source or ontology', async () => {
    const fixture = makeFixture();
    const raw = JSON.stringify({ session_id: 'session-1' });
    const beforeSource = fs.readFileSync(fixture.sourcePath);
    const beforeIndex = fs.readFileSync(path.join(fixture.root, '.claude', 'ontology', 'index.json'));
    try {
      fs.writeFileSync(fixture.logPath, `${JSON.stringify({
        schemaVersion: 1,
        id: 'ontology-observation-1234567890abcdef12345678',
        eventType: 'file_changed',
        sessionId: 'session-1',
        projectRoot: fixture.root,
        domainKey: 'domain_example',
        filePath: 'src/example.js',
        contentFingerprint: sha256(fs.readFileSync(fixture.sourcePath)),
        observedAt: '2026-07-25T00:00:00.000Z',
      })}\n`, 'utf8');
      const result = spawnSync(process.execPath, [runnerPath,
        'session:end:ontology-maintenance',
        'scripts/hooks/ontology-maintenance.js',
        '--request-file',
        'scripts/hooks/requests/minimal-standard-strict.json',
      ], {
        input: raw,
        encoding: 'utf8',
        cwd: fixture.root,
        env: {
          ...process.env,
          HOME: fixture.homeDir,
          ECC_ONTOLOGY_MAINTENANCE: '1',
          OMF_ONTOLOGY_OBSERVATION_LOG: fixture.logPath,
          CLAUDE_PLUGIN_ROOT: repoRoot,
        },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, raw);
      const store = await createStateStore({ homeDir: fixture.homeDir });
      try {
        assert.strictEqual(store.listOntologyCandidates({ projectRoot: fixture.root }).totalCount, 1);
      } finally {
        store.close();
      }
      assert.deepStrictEqual(fs.readFileSync(fixture.sourcePath), beforeSource);
      assert.deepStrictEqual(fs.readFileSync(path.join(fixture.root, '.claude', 'ontology', 'index.json')), beforeIndex);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('passes through unchanged while lifecycle maintenance is disabled', () => {
    const raw = '{"session_id":"disabled"}';
    const result = spawnSync(process.execPath, [runnerPath,
      'session:end:ontology-maintenance',
      'scripts/hooks/ontology-maintenance.js',
      '--request-file',
      'scripts/hooks/requests/minimal-standard-strict.json',
    ], {
      input: raw,
      encoding: 'utf8',
      env: { ...process.env, ECC_ONTOLOGY_MAINTENANCE: '0', CLAUDE_PLUGIN_ROOT: repoRoot },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, raw);
  });

  await test('does not create a state store for a missing spool or a busy drain lock', () => {
    const fixture = makeFixture();
    const raw = '{"session_id":"idle"}';
    const invoke = () => spawnSync(process.execPath, [runnerPath,
      'session:end:ontology-maintenance', 'scripts/hooks/ontology-maintenance.js',
      '--request-file', 'scripts/hooks/requests/minimal-standard-strict.json',
    ], {
      input: raw,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fixture.homeDir,
        CLAUDE_PLUGIN_ROOT: repoRoot,
        ECC_ONTOLOGY_MAINTENANCE: '1',
        OMF_ONTOLOGY_OBSERVATION_LOG: fixture.logPath,
      },
    });
    try {
      const missing = invoke();
      assert.strictEqual(missing.status, 0, missing.stderr);
      assert.strictEqual(missing.stdout, raw);
      assert.ok(!fs.existsSync(path.join(fixture.homeDir, '.claude', 'ecc', 'state.db')));

      fs.writeFileSync(fixture.logPath, '{}\n', 'utf8');
      fs.writeFileSync(`${fixture.logPath}.drain.lock`, 'busy', 'utf8');
      const locked = invoke();
      assert.strictEqual(locked.status, 0, locked.stderr);
      assert.strictEqual(locked.stdout, raw);
      assert.ok(!fs.existsSync(path.join(fixture.homeDir, '.claude', 'ecc', 'state.db')));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await test('keeps maintenance on the legacy runner path for awaited state-store work', () => {
    const source = fs.readFileSync(maintenancePath, 'utf8');
    assert.ok(!source.includes('module.exports'), 'async maintenance must not be direct-required by run-with-flags');
  });

  await test('registers lifecycle maintenance as an asynchronous SessionEnd hook', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
    const entry = hooks.hooks.SessionEnd.find(item => item.hooks.some(hook =>
      hook.command.includes('session:end:ontology-maintenance')));
    assert.ok(entry, 'missing SessionEnd ontology maintenance registration');
    assert.strictEqual(entry.matcher, '*');
    assert.strictEqual(entry.hooks[0].async, true);
    assert.ok(entry.hooks[0].timeout > 0);
    assert.ok(entry.hooks[0].command.includes('run-with-flags.js'));
    assert.ok(entry.hooks[0].command.includes('ontology-maintenance.js'));
  });
}

main().catch(error => {
  console.error(`  FAIL ${error.stack || error.message}`);
  process.exit(1);
});
