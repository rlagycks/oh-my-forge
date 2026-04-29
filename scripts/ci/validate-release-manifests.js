#!/usr/bin/env node
'use strict';

const path = require('path');

const {
  readReleaseManifestVersions,
  findReleaseManifestVersionMismatches,
  findMissingPackagedPaths,
} = require('../lib/release-manifests');

const ROOT = path.join(__dirname, '../..');

const snapshot = readReleaseManifestVersions(ROOT);
const mismatches = [
  ...findReleaseManifestVersionMismatches(snapshot),
  ...findMissingPackagedPaths(snapshot),
];

if (mismatches.length > 0) {
  console.error('ERROR: release manifest metadata is out of sync');
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

console.log(`Validated release manifest metadata (${snapshot.packageVersion})`);
