#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findMissingDeclaredPackagePaths,
  findMissingRequiredArtifactPaths,
  findUntrackedAgentArtifactPaths,
  normalizePackagePath,
} = require('../lib/package-artifact');

const ROOT = path.join(__dirname, '../..');

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with ${result.status}`);
  }
  return result.stdout;
}

function readPackageArtifactPaths() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-npm-pack-cache-'));
  try {
    const stdout = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', `--cache=${cacheDir}`]);
    const packages = JSON.parse(stdout);
    const files = Array.isArray(packages) && packages.length === 1 && Array.isArray(packages[0].files)
      ? packages[0].files
      : null;

    if (!files) {
      throw new Error('npm pack --dry-run did not return a single package file list');
    }

    return new Set(files.map(file => normalizePackagePath(file && file.path)).filter(Boolean));
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

function readDeclaredPackagePaths() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return Array.isArray(packageJson.files) ? packageJson.files : [];
}

function readSourcePaths(declaredPaths) {
  return new Set(
    declaredPaths
      .map(normalizePackagePath)
      .filter(Boolean)
      .filter(relativePath => fs.existsSync(path.join(ROOT, relativePath)))
  );
}

function readTrackedAgentPaths() {
  return new Set(
    run('git', ['ls-files', '-z', '--', '.agents/'])
      .split('\0')
      .filter(Boolean)
      .map(normalizePackagePath)
      .filter(Boolean)
  );
}

function validatePackageArtifact() {
  const declaredPaths = readDeclaredPackagePaths();
  const artifactPaths = readPackageArtifactPaths();
  const errors = [
    ...findMissingDeclaredPackagePaths(declaredPaths, readSourcePaths(declaredPaths)),
    ...findMissingRequiredArtifactPaths(artifactPaths)
      .map(relativePath => `${relativePath} is required in the published package but is absent from npm pack`),
    ...findUntrackedAgentArtifactPaths(artifactPaths, readTrackedAgentPaths())
      .map(relativePath => `${relativePath} is present in the published package but is not tracked by git`),
  ];

  if (errors.length > 0) {
    console.error('ERROR: package artifact validation failed');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Validated package artifact (${artifactPaths.size} files)`);
}

validatePackageArtifact();
