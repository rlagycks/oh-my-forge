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
  // Try multiple formats to capture all test summary styles:
  // 1. "N tests: X passed, Y failed" (most specific, prefer this)
  // 2. "X passed, Y failed" (common format)
  // 3. "Passed: X" and "Failed: Y" (separate lines, capital P/F)

  let filePassed = 0;
  let fileFailed = 0;

  // Try format 1: "N tests: X passed, Y failed"
  const testCountFormat = result.stdout && result.stdout.match(/(\d+)\s+tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed/);
  if (testCountFormat) {
    filePassed = parseInt(testCountFormat[2], 10);
    fileFailed = parseInt(testCountFormat[3], 10);
  } else {
    // Try format 2: "X passed, Y failed" (case-insensitive)
    const passedFailedFormat = result.stdout && result.stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/i);
    if (passedFailedFormat) {
      filePassed = parseInt(passedFailedFormat[1], 10);
      fileFailed = parseInt(passedFailedFormat[2], 10);
    } else {
      // Try format 3: Separate "Passed: X" and "Failed: Y" lines
      const passedMatch = result.stdout && result.stdout.match(/Passed:\s*(\d+)/);
      const failedMatch = result.stdout && result.stdout.match(/Failed:\s*(\d+)/);
      if (passedMatch) filePassed = parseInt(passedMatch[1], 10);
      if (failedMatch) fileFailed = parseInt(failedMatch[1], 10);
    }
  }

  totalPassed += filePassed;
  totalFailed += fileFailed;

  if (result.status !== 0) {
    console.error(`\nFAILED: ${relative}`);
    anyNonZero = true;
  }
}

const total = totalPassed + totalFailed;
console.log(`\nTotal Tests:    ${total}`);
console.log(`${totalPassed} passed, ${totalFailed} failed`);
process.exit(anyNonZero ? 1 : 0);
