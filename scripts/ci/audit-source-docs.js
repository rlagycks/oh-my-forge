#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeSourceDocs, uniqueStrings } = require('../lib/ontology-routing');

const DEFAULT_DOCS_DIRS = ['docs'];
const SOURCE_DOC_PATTERNS = [
  /(^|[.-])prd\.md$/,
  /(^|[.-])api\.md$/,
  /(^|[.-])openapi\.md$/,
  /(^|[.-])spec\.md$/,
  /(^|[.-])requirements\.md$/,
  /(^|[.-])feature-definition\.md$/,
  /(^|[.-])design-contract\.md$/,
  /(^|[.-])contract\.md$/,
];

function toPosixPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function normalizeRepoPath(filePath) {
  return toPosixPath(filePath).replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function isInsideRoot(rootDir, targetPath) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasParentSegment(filePath) {
  return toPosixPath(filePath).split('/').includes('..');
}

function readJson(filePath, diagnostics = []) {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    diagnostics.push(`Failed to parse JSON: ${filePath} (${err.message})`);
    return null;
  }
}

function collectMarkdownFiles(dir, repoRoot) {
  if (!fs.existsSync(dir)) return [];

  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath, repoRoot));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(normalizeRepoPath(path.relative(repoRoot, fullPath)));
    }
  }

  return results;
}

function isSourceDocCandidate(filePath) {
  const basename = path.posix.basename(normalizeRepoPath(filePath)).toLowerCase();
  return SOURCE_DOC_PATTERNS.some(pattern => pattern.test(basename));
}

function sourceDocValues(sourceDocs = {}) {
  return Object.values(normalizeSourceDocs(sourceDocs)).flat();
}

function resolveDetailPath(repoRoot, ontologyRoot, detailPath, diagnostics = []) {
  const cleanDetailPath = String(detailPath || '').trim();
  if (!cleanDetailPath) return null;

  if (path.isAbsolute(cleanDetailPath) || hasParentSegment(cleanDetailPath)) {
    diagnostics.push(`Invalid ontology detail path: ${cleanDetailPath}`);
    return null;
  }

  const candidates = uniqueStrings([
    path.resolve(repoRoot, cleanDetailPath),
    path.resolve(ontologyRoot, cleanDetailPath),
  ]);
  for (const candidate of candidates) {
    if (!isInsideRoot(repoRoot, candidate)) {
      diagnostics.push(`Invalid ontology detail path outside repo: ${cleanDetailPath}`);
      continue;
    }
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates.find(candidate => isInsideRoot(repoRoot, candidate)) || null;
}

function collectLinkedSourceDocs(repoRoot, ontologyRoot, diagnostics = []) {
  const indexPath = path.join(ontologyRoot, 'index.json');
  const index = readJson(indexPath, diagnostics) || {};
  const linked = [];

  for (const [key, entry] of Object.entries(index)) {
    if (key.startsWith('$')) continue;
    if (!entry || typeof entry !== 'object') continue;
    if (hasOwn(entry, 'sourceDocs')) {
      linked.push(...sourceDocValues(entry.sourceDocs));
    }

    if (typeof entry.detail === 'string' && entry.detail.trim()) {
      const detailPath = resolveDetailPath(repoRoot, ontologyRoot, entry.detail, diagnostics);
      const detail = detailPath ? readJson(detailPath, diagnostics) : null;
      if (detail && typeof detail === 'object' && hasOwn(detail, 'sourceDocs')) {
        linked.push(...sourceDocValues(detail.sourceDocs));
      }
    }
  }

  return uniqueStrings(linked.map(normalizeRepoPath)).sort();
}

function auditSourceDocs(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const ontologyRoot = path.resolve(repoRoot, options.ontologyRoot || path.join('.claude', 'ontology'));
  const docsDirs = Array.isArray(options.docsDirs) && options.docsDirs.length > 0
    ? options.docsDirs
    : DEFAULT_DOCS_DIRS;
  const diagnostics = [];

  const candidates = uniqueStrings(
    docsDirs.flatMap(docsDir => collectMarkdownFiles(path.resolve(repoRoot, docsDir), repoRoot))
      .filter(isSourceDocCandidate)
      .map(normalizeRepoPath)
  ).sort();
  const linked = collectLinkedSourceDocs(repoRoot, ontologyRoot, diagnostics);
  const linkedSet = new Set(linked);
  const missing = candidates.filter(candidate => !linkedSet.has(candidate));

  return {
    repoRoot,
    candidates,
    linked,
    missing,
    diagnostics,
  };
}

function parseArgs(argv) {
  const options = {
    strict: false,
    json: false,
    docsDirs: [],
  };

  const readFlagValue = (index, flag) => {
    const hasNext = hasOwn(argv, index + 1);
    const value = hasNext ? argv[index + 1] : undefined;
    if (!hasNext || String(value || '').startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--repo-root') {
      options.repoRoot = readFlagValue(index, arg);
      index++;
    } else if (arg === '--ontology-root') {
      options.ontologyRoot = readFlagValue(index, arg);
      index++;
    } else if (arg === '--docs-dir') {
      options.docsDirs.push(readFlagValue(index, arg));
      index++;
    }
  }

  return options;
}

function printTextReport(report) {
  console.log('SourceDocs coverage audit');
  console.log(`Candidates: ${report.candidates.length}`);
  console.log(`Linked: ${report.linked.length}`);
  console.log(`Missing: ${report.missing.length}`);

  if (report.missing.length > 0) {
    console.log('\nMissing sourceDocs links:');
    for (const missing of report.missing) {
      console.log(`- ${missing}`);
    }
  }

  if (report.diagnostics.length > 0) {
    console.log('\nDiagnostics:');
    for (const diagnostic of report.diagnostics) {
      console.log(`- ${diagnostic}`);
    }
  }
}

function runCli() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = auditSourceDocs(options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }

    if (options.strict && (report.missing.length > 0 || report.diagnostics.length > 0)) {
      process.exit(1);
    }
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  auditSourceDocs,
  isSourceDocCandidate,
};
