'use strict';

const { spawn: defaultSpawn } = require('child_process');
const path = require('path');

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

function normalizeTerminationGrace(terminationGraceMs) {
  if (terminationGraceMs === undefined) return TERMINATION_GRACE_MS;
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 1 || terminationGraceMs > 5_000) {
    throw new Error('terminationGraceMs must be an integer between 1 and 5000');
  }
  return terminationGraceMs;
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

function getTrustedWindowsTaskkillPath(systemRoot) {
  const normalizedRoot = typeof systemRoot === 'string' ? path.win32.normalize(systemRoot) : null;
  const root = normalizedRoot && /^[a-z]:\\windows$/i.test(normalizedRoot)
    ? normalizedRoot
    : 'C:\\Windows';
  return path.win32.join(root, 'System32', 'taskkill.exe');
}

function waitForChildClose(child) {
  return new Promise(resolve => {
    if (!child || typeof child.once !== 'function') {
      resolve();
      return;
    }
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
}

function terminateWindowsProcessTree(child, { spawnTreeKiller, systemRoot, environment } = {}) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0 || typeof spawnTreeKiller !== 'function') {
    return Promise.resolve();
  }
  let killer;
  try {
    killer = spawnTreeKiller(getTrustedWindowsTaskkillPath(systemRoot), [
      '/PID', String(child.pid), '/T', '/F',
    ], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
      env: buildBoundedOntologyMaintainerEnvironment(environment),
    });
  } catch (_error) {
    return Promise.resolve();
  }
  return waitForChildClose(killer);
}

function terminateProcessTree(child, signal, {
  platform = process.platform,
  spawnTreeKiller = defaultSpawn,
  systemRoot,
  environment,
} = {}) {
  if (!child) return Promise.resolve();
  if (platform === 'win32') {
    closeStandardInput(child);
    try {
      if (typeof child.kill === 'function') child.kill(signal);
    } catch (_error) {
      // taskkill below remains the tree-wide termination boundary.
    }
    return terminateWindowsProcessTree(child, { spawnTreeKiller, systemRoot, environment });
  }
  if (Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return Promise.resolve();
    } catch (_error) {
      // The child may not own a process group; fall through to child.kill().
    }
  }
  try {
    if (typeof child.kill === 'function') child.kill(signal);
  } catch (_error) {
    // Best effort only; close event still determines completion.
  }
  return Promise.resolve();
}

function runBoundedOntologyMaintainerProcess({
  command, args, input, timeoutMs, environment, spawnProcess = defaultSpawn,
  spawnTreeKiller = defaultSpawn, platform = process.platform, systemRoot, terminationGraceMs,
} = {}) {
  assertFixedProcessInvocation({ command, args, input });
  const effectiveTimeout = normalizeTimeout(timeoutMs);
  const effectiveTerminationGrace = normalizeTerminationGrace(terminationGraceMs);
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
    let terminationPromise = Promise.resolve();
    let hardKillPromise = Promise.resolve();
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
      Promise.all([terminationPromise, hardKillPromise]).then(() => resolve(result));
    };
    const requestTermination = () => {
      if (terminating) return;
      terminating = true;
      closeStandardInput(child);
      terminationPromise = terminateProcessTree(child, 'SIGTERM', {
        platform, spawnTreeKiller, systemRoot, environment,
      });
      if (platform !== 'win32') {
        hardKillPromise = new Promise(resolve => {
          setTimeout(() => {
            terminationPromise = terminationPromise.then(() => terminateProcessTree(child, 'SIGKILL', {
              platform, spawnTreeKiller, systemRoot, environment,
            }));
            terminationPromise.then(resolve);
          }, effectiveTerminationGrace);
        });
      }
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
      settled = true;
      Promise.all([terminationPromise, hardKillPromise]).then(() => reject(error));
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
  getTrustedWindowsTaskkillPath,
  runBoundedOntologyMaintainerProcess,
  terminateProcessTree,
  terminateWindowsProcessTree,
};
