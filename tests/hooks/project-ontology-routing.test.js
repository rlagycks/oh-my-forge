'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const domainContextInjectPath = path.resolve(__dirname, '../../scripts/hooks/domain-context-inject.js');
const constraintGuardPath = path.resolve(__dirname, '../../scripts/hooks/constraint-guard.js');
const qaContextInjectPath = path.resolve(__dirname, '../../scripts/hooks/qa-context-inject.js');
const preWriteEditCodexGuardPath = path.resolve(__dirname, '../../scripts/hooks/pre-write-edit-codex-guard.js');

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeBugTopology(rootDir, fileMap, bugId) {
  const content = [
    '# Bug Topology',
    '',
    '## File → Bug Map',
    '```json',
    JSON.stringify(fileMap, null, 2),
    '```',
    '',
    '| ID | Summary |',
    '| --- | --- |',
    `| ${bugId} | Repeated bug |`,
    '',
  ].join('\n');

  mkdirp(path.join(rootDir, 'docs', 'qa'));
  fs.writeFileSync(path.join(rootDir, 'docs', 'qa', 'bug-topology.md'), content, 'utf8');
}

function makeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-ontology-hooks-'));
  const projectRoot = path.join(tempRoot, 'project');
  const pluginRoot = path.join(tempRoot, 'plugin-cache');
  const trackedFile = path.join(projectRoot, 'src', 'tracked.js');

  mkdirp(path.join(projectRoot, '.claude', 'ontology'));
  mkdirp(path.join(projectRoot, 'src'));
  mkdirp(path.join(pluginRoot, '.claude', 'ontology'));

  fs.writeFileSync(trackedFile, 'module.exports = 1;\n', 'utf8');

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_project: {
      summary: 'project-owned domain',
      owner: 'project',
      files: ['src/tracked.js'],
      spec: 'docs/features/project.md',
      constraints: ['Project forbids fetch|pattern:fetch('],
    },
  });

  writeJson(path.join(pluginRoot, '.claude', 'ontology', 'index.json'), {
    domain_plugin: {
      summary: 'plugin-owned domain',
      owner: 'plugin',
      files: ['plugin-only.js'],
      spec: 'docs/features/plugin.md',
      constraints: ['Plugin forbids axios|pattern:axios'],
    },
  });

  writeBugTopology(projectRoot, { 'src/tracked.js': ['QA-001'] }, 'QA-001');
  writeBugTopology(pluginRoot, { 'plugin-only.js': ['QA-999'] }, 'QA-999');

  return { tempRoot, projectRoot, pluginRoot, trackedFile };
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

function captureExit(fn) {
  const originalExit = process.exit;
  const originalStdout = process.stdout.write.bind(process.stdout);
  let exitCode = null;
  let stdout = '';

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`__EXIT_${code}__`);
  };
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };

  try {
    fn();
  } catch (err) {
    if (!String(err.message).startsWith('__EXIT_')) {
      process.exit = originalExit;
      process.stdout.write = originalStdout;
      throw err;
    }
  }

  process.exit = originalExit;
  process.stdout.write = originalStdout;
  return { exitCode, stdout };
}

function makeInput(toolName, filePath, extraToolInput = {}) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: {
      file_path: filePath,
      content: 'fetch("https://example.com")',
      ...extraToolInput,
    },
  });
}

function freshRequire(modulePath) {
  delete require.cache[modulePath];
  return require(modulePath);
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

console.log('\nproject-ontology-routing.test.js');

if (test('domain-context-inject uses the project ontology even when CLAUDE_PLUGIN_ROOT points elsewhere', () => {
  const fixture = makeFixture();
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_PLUGIN_ROOT = fixture.pluginRoot;
  process.env.CLAUDE_SESSION_ID = `domain-${Date.now()}`;

  try {
    const { run } = freshRequire(domainContextInjectPath);
    const stderr = withCapturedStderr(() => {
      const result = run(makeInput('Edit', fixture.trackedFile));
      assert.strictEqual(result, makeInput('Edit', fixture.trackedFile));
    });
    assert.ok(stderr.includes('[DOMAIN] domain_project'), stderr);
    assert.ok(!stderr.includes('domain_plugin'), stderr);
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_PLUGIN_ROOT;
    delete process.env.CLAUDE_SESSION_ID;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('constraint-guard uses the project ontology constraints under plugin root mismatch', () => {
  const fixture = makeFixture();
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_PLUGIN_ROOT = fixture.pluginRoot;
  process.env.CLAUDE_SESSION_ID = `constraint-${Date.now()}`;

  try {
    const { run } = freshRequire(constraintGuardPath);
    const stderr = withCapturedStderr(() => {
      const result = run(makeInput('Edit', fixture.trackedFile, { new_string: 'fetch("https://example.com")' }));
      assert.strictEqual(result, makeInput('Edit', fixture.trackedFile, { new_string: 'fetch("https://example.com")' }));
    });
    assert.ok(stderr.includes('[CONSTRAINT GUARD] domain_project'), stderr);
    assert.ok(stderr.includes('Project forbids fetch'), stderr);
    assert.ok(!stderr.includes('domain_plugin'), stderr);
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_PLUGIN_ROOT;
    delete process.env.CLAUDE_SESSION_ID;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('qa-context-inject reads bug topology from the project root instead of plugin cache', () => {
  const fixture = makeFixture();
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_PLUGIN_ROOT = fixture.pluginRoot;

  try {
    const { run } = freshRequire(qaContextInjectPath);
    const stderr = withCapturedStderr(() => {
      const result = run(makeInput('Edit', fixture.trackedFile));
      assert.strictEqual(result, makeInput('Edit', fixture.trackedFile));
    });
    assert.ok(stderr.includes('[QA] Bug history found for tracked.js'), stderr);
    assert.ok(stderr.includes('QA-001'), stderr);
    assert.ok(!stderr.includes('QA-999'), stderr);
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_PLUGIN_ROOT;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('pre-write-edit-codex-guard blocks project-tracked files even when plugin root points elsewhere', () => {
  const fixture = makeFixture();
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_PLUGIN_ROOT = fixture.pluginRoot;
  process.env.CLAUDE_IMPL_ENGINE = 'codex';

  try {
    const { run } = freshRequire(preWriteEditCodexGuardPath);
    const { exitCode, stdout } = captureExit(() => run(makeInput('Edit', fixture.trackedFile)));
    assert.strictEqual(exitCode, 2);
    assert.ok(stdout.includes('domain_project'), stdout);
    assert.ok(!stdout.includes('domain_plugin'), stdout);
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_PLUGIN_ROOT;
    delete process.env.CLAUDE_IMPL_ENGINE;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
