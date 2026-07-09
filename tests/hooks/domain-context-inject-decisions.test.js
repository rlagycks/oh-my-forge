'use strict';

/**
 * Covers Change 3: domain-context-inject.js surfaces a domain's most recent
 * decisions[] (from decisions.js's storage shape) as short one-liners,
 * capped at 3, respecting the existing once-per-session dedup.
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

function makeFixture({ decisions } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-decisions-'));
  const projectRoot = path.join(tempRoot, 'project');
  const trackedFile = path.join(projectRoot, 'src', 'tracked.js');

  mkdirp(path.join(projectRoot, '.claude', 'ontology'));
  mkdirp(path.join(projectRoot, 'src'));
  fs.writeFileSync(trackedFile, 'module.exports = 1;\n', 'utf8');

  const domainData = {
    domain: 'domain_project',
    version: '1.0',
    summary: 'project domain summary',
    constraints: ['Keep it simple'],
    retrievalProfiles: {
      context: {
        include: ['summary', 'constraints'],
        maxFailurePatterns: 0,
        maxDecisions: 0,
      },
    },
  };
  if (decisions) domainData.decisions = decisions;

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'domain_project.json'), domainData);

  writeJson(path.join(projectRoot, '.claude', 'ontology', 'index.json'), {
    domain_project: {
      summary: 'project-owned domain',
      owner: 'project',
      files: ['src/tracked.js'],
      detail: '.claude/ontology/domain_project.json',
    },
  });

  return { tempRoot, projectRoot, trackedFile };
}

function makeInput(toolName, filePath) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath },
  });
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

console.log('\ndomain-context-inject-decisions.test.js');

if (test('appends the 3 most recent decisions, most recent first, with truncated why', () => {
  const longWhy = 'a'.repeat(150);
  const fixture = makeFixture({
    decisions: [
      { id: 'dec-1', date: '2026-01-01', type: 'bug-fix', domain: 'domain_project', summary: 'oldest fix', why: 'root cause one' },
      { id: 'dec-2', date: '2026-01-02', type: 'design', domain: 'domain_project', summary: 'second decision', why: 'root cause two' },
      { id: 'dec-3', date: '2026-01-03', type: 'refactor', domain: 'domain_project', summary: 'third decision', why: 'root cause three' },
      { id: 'dec-4', date: '2026-01-04', type: 'bug-fix', domain: 'domain_project', summary: 'newest fix', why: longWhy },
    ],
  });
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_SESSION_ID = `decisions-${Date.now()}`;

  try {
    const { run } = freshRequire(domainContextInjectPath);
    const stderr = withCapturedStderr(() => {
      run(makeInput('Edit', fixture.trackedFile));
    });

    assert.ok(stderr.includes('Recent Decisions:'), stderr);
    // Only the 3 most recent (dec-2, dec-3, dec-4), newest first — dec-1 must not appear.
    assert.ok(!stderr.includes('oldest fix'), stderr);
    assert.ok(stderr.includes('[bug-fix] newest fix'), stderr);
    assert.ok(stderr.includes('[refactor] third decision'), stderr);
    assert.ok(stderr.includes('[design] second decision'), stderr);

    const newestIndex = stderr.indexOf('newest fix');
    const thirdIndex = stderr.indexOf('third decision');
    const secondIndex = stderr.indexOf('second decision');
    assert.ok(newestIndex < thirdIndex && thirdIndex < secondIndex, 'decisions should be ordered most-recent-first');

    // why truncated to 100 chars + ellipsis
    const whyMatch = stderr.match(/why: (a+\.\.\.)\)/);
    assert.ok(whyMatch, stderr);
    assert.strictEqual(whyMatch[1].length, 103, 'truncated why should be 100 chars + "..."');
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_SESSION_ID;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('adds nothing when the domain has no decisions', () => {
  const fixture = makeFixture();
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_SESSION_ID = `no-decisions-${Date.now()}`;

  try {
    const { run } = freshRequire(domainContextInjectPath);
    const stderr = withCapturedStderr(() => {
      run(makeInput('Edit', fixture.trackedFile));
    });
    assert.ok(!stderr.includes('Recent Decisions:'), stderr);
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_SESSION_ID;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('respects the once-per-session dedup — second edit of the same domain injects nothing more', () => {
  const fixture = makeFixture({
    decisions: [
      { id: 'dec-1', date: '2026-01-01', type: 'bug-fix', domain: 'domain_project', summary: 'first fix', why: 'why one' },
    ],
  });
  const originalCwd = process.cwd();
  process.chdir(fixture.projectRoot);
  process.env.CLAUDE_SESSION_ID = `dedup-${Date.now()}`;

  try {
    const { run } = freshRequire(domainContextInjectPath);
    const first = withCapturedStderr(() => run(makeInput('Edit', fixture.trackedFile)));
    assert.ok(first.includes('Recent Decisions:'), first);

    const second = withCapturedStderr(() => run(makeInput('Edit', fixture.trackedFile)));
    assert.strictEqual(second, '', 'second injection for the same domain in-session should be a no-op');
  } finally {
    process.chdir(originalCwd);
    delete process.env.CLAUDE_SESSION_ID;
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
