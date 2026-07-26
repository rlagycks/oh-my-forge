#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RELEASE_GATE = path.join(ROOT, 'tests', 'e2e', 'ontology-maintainer-release-gate.test.js');
const result = spawnSync(process.execPath, [RELEASE_GATE], { cwd: ROOT, encoding: 'utf8' });

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
