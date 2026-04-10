#!/usr/bin/env node
'use strict';

/**
 * Test runner — executes all *.test.js files under tests/
 * Aggregates Passed/Failed counts from each test file's stdout.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testsDir = __dirname;
const CI_TESTS = [
  path.join(testsDir, 'ci', 'validate-no-relative-scripts.test.js'),
];

function findTestFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const discovered = findTestFiles(testsDir);
const prioritized = CI_TESTS.filter(fs.existsSync);
const testFiles = [...new Set([...prioritized, ...discovered])];

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

let totalPassed = 0;
let totalFailed = 0;
let anyNonZero = false;

for (const file of testFiles) {
  const relative = path.relative(testsDir, file);
  console.log(`\nRunning ${relative}`);

  const result = spawnSync(process.execPath, [file], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Parse Passed/Failed counts from child output
  const passedMatch = result.stdout && result.stdout.match(/Passed:\s*(\d+)/);
  const failedMatch = result.stdout && result.stdout.match(/Failed:\s*(\d+)/);
  if (passedMatch) totalPassed += parseInt(passedMatch[1], 10);
  if (failedMatch) totalFailed += parseInt(failedMatch[1], 10);

  if (result.status !== 0) {
    console.error(`\nFAILED: ${relative}`);
    anyNonZero = true;
  }
}

const total = totalPassed + totalFailed;
console.log(`\nTotal Tests:    ${total}`);
console.log(`${totalPassed} passed, ${totalFailed} failed`);
process.exit(anyNonZero ? 1 : 0);
