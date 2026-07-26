#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const { findWorktreeChanges } = require('../lib/release-preflight');

const result = childProcess.spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  encoding: 'utf8',
});

if (result.error || result.status !== 0) {
  console.error(`ERROR: could not inspect release worktree: ${result.error || result.stderr}`);
  process.exit(1);
}

const changes = findWorktreeChanges(result.stdout);
if (changes.length > 0) {
  console.error('ERROR: release requires a completely clean worktree (including staged and untracked files)');
  for (const change of changes) console.error(`- ${change}`);
  process.exit(1);
}

console.log('Validated clean release worktree');
