/**
 * Tests for run-with-flags.js request-file support
 *
 * Run with: node tests/hooks/run-with-flags-request-file.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

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

const repoRoot = path.resolve(__dirname, '..', '..');
const runnerPath = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');

function runHook(profile) {
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      'test:hook',
      'tests/fixtures/hook-runner-fixture.js',
      '--request-file',
      'scripts/hooks/requests/strict.json',
    ],
    {
      encoding: 'utf8',
      input: 'RAW_INPUT',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: repoRoot,
        ECC_HOOK_PROFILE: profile,
      },
      cwd: repoRoot,
    }
  );

  if (result.error) {
    throw result.error;
  }
  return result;
}

let passed = 0;
let failed = 0;

console.log('\nrun-with-flags-request-file.test.js');

if (
  test('does not execute when profile not allowed', () => {
    const result = runHook('standard');
    assert.strictEqual(result.status, 0, 'Runner should exit 0 on passthrough');
    assert.strictEqual(result.stdout, 'RAW_INPUT', 'Runner should passthrough raw input when disabled');
  })
) passed++;
else failed++;

if (
  test('executes when profile is allowed via request-file', () => {
    const result = runHook('strict');
    assert.strictEqual(result.status, 0, 'Runner should exit 0 when hook succeeds');
    assert.strictEqual(result.stdout, 'HOOK_EXECUTED', 'Runner should emit hook output when enabled');
  })
) passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);

