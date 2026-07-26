'use strict';

const { spawn: defaultSpawn } = require('child_process');

const MAX_PROCESS_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_PROCESS_INPUT_BYTES = 128 * 1024;
const TERMINATION_GRACE_MS = 1_000;
const TRUSTED_PATH = process.platform === 'win32' ? `${process.env.SystemRoot || 'C:\\Windows'}\\System32` : '/usr/bin:/bin';

function assertBoundedString(value, name, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error(`${name} must be a bounded single-line string`);
  }
}

function buildBoundedOntologyMaintainerEnvironment(environment = process.env) {
  void environment;
  return { PATH: TRUSTED_PATH, LANG: 'C', LC_ALL: 'C' };
}

function normalizeTimeout(timeoutMs) {
  if (timeoutMs === undefined) return MAX_PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PROCESS_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between 1 and ${MAX_PROCESS_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function assertFixedProcessInvocation({ command, args, input }) {
  assertBoundedString(command, 'command', 512);
  if (!Array.isArray(args) || args.length > 12) throw new Error('args must be a fixed bounded array');
  for (const arg of args) assertBoundedString(arg, 'args item', 128);
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_PROCESS_INPUT_BYTES) {
    throw new Error(`input must be at most ${MAX_PROCESS_INPUT_BYTES} bytes`);
  }
}

function closeStandardInput(child) {
  if (!child || !child.stdin) return;
  try {
    if (typeof child.stdin.end === 'function') child.stdin.end();
    if (typeof child.stdin.destroy === 'function') child.stdin.destroy();
  } catch (_error) {
    // Best effort only; close event still determines completion.
  }
}

function terminateProcessTree(child, signal) {
  if (!child) return;
  if (process.platform !== 'win32' && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (_error) {
      // The child may not own a process group; fall through to child.kill().
    }
  }
  try {
    if (typeof child.kill === 'function') child.kill(signal);
  } catch (_error) {
    // Best effort only; close event still determines completion.
  }
}

function runBoundedOntologyMaintainerProcess({
  command, args, input, timeoutMs, environment, spawnProcess = defaultSpawn,
} = {}) {
  assertFixedProcessInvocation({ command, args, input });
  const effectiveTimeout = normalizeTimeout(timeoutMs);
  if (typeof spawnProcess !== 'function') throw new Error('spawnProcess must be a function');
  const options = {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildBoundedOntologyMaintainerEnvironment(environment),
    detached: process.platform !== 'win32',
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, [...args], options);
    } catch (error) {
      reject(error);
      return;
    }
    if (!child || typeof child.once !== 'function' || !child.stdout || !child.stderr || !child.stdin) {
      reject(new Error('spawnProcess must return a child process with standard streams'));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    let terminating = false;
    let hardKillTimer = null;
    const snapshot = (exitCode = null, signal = null) => ({
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      signal: typeof signal === 'string' ? signal : null,
      timedOut,
      outputLimitExceeded,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
    });
    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      resolve(result);
    };
    const requestTermination = () => {
      if (terminating) return;
      terminating = true;
      closeStandardInput(child);
      terminateProcessTree(child, 'SIGTERM');
      hardKillTimer = setTimeout(() => terminateProcessTree(child, 'SIGKILL'), TERMINATION_GRACE_MS);
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > MAX_PROCESS_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        requestTermination();
        return next.subarray(0, MAX_PROCESS_OUTPUT_BYTES);
      }
      return next;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, effectiveTimeout);
    child.once('error', error => {
      if (settled) return;
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      settled = true;
      reject(error);
    });
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('close', (exitCode, signal) => settle(snapshot(exitCode, signal)));
    child.stdin.end(input);
  });
}

module.exports = {
  MAX_PROCESS_INPUT_BYTES,
  MAX_PROCESS_OUTPUT_BYTES,
  MAX_PROCESS_TIMEOUT_MS,
  TERMINATION_GRACE_MS,
  TRUSTED_PATH,
  buildBoundedOntologyMaintainerEnvironment,
  closeStandardInput,
  runBoundedOntologyMaintainerProcess,
  terminateProcessTree,
};
