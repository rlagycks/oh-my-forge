#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const suitePath = path.join(__dirname, '../../docs/evals/golden-tasks.json');
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
const task = suite.tasks.find(candidate => candidate.id === 'rca-root-cause-evidence');
const errors = [];

if (!task) {
  errors.push('rca-root-cause-evidence task is missing');
} else {
  if (!/root.?cause|investigation/i.test(task.prompt)) errors.push('prompt must name the root-cause investigation target');
  if (!task.success_criteria.some(criterion => /scope/i.test(criterion))) errors.push('success criteria must include a scope check');
  if (!task.success_criteria.some(criterion => /deterministic|acceptance|evidence/i.test(criterion))) {
    errors.push('success criteria must include deterministic acceptance evidence');
  }
  if (task.verification.argv[0] !== 'node' || task.verification.expected_exit_code !== 0) {
    errors.push('RCA verification must remain a deterministic node command');
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log('Validated: RCA golden task includes root-cause, scope, and deterministic evidence criteria');
