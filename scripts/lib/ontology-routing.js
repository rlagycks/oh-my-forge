'use strict';

const fs = require('fs');
const path = require('path');

function normalizeOntologyPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function walkUpForOntology(startDir, maxDepth = 10) {
  if (!startDir) return null;

  let dir = path.resolve(startDir);
  const fsRoot = path.parse(dir).root;
  let depth = 0;

  while (dir !== fsRoot && depth < maxDepth) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
    depth++;
  }

  return null;
}

function resolveProjectOntologyRoot(options = {}) {
  const filePath = options.filePath ? path.resolve(options.filePath) : '';
  const cwd = path.resolve(options.cwd || process.cwd());
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 10;

  if (filePath) {
    const fromFile = walkUpForOntology(path.dirname(filePath), maxDepth);
    if (fromFile) return fromFile;
  }

  return walkUpForOntology(cwd, maxDepth);
}

function loadDomainFile(domainFilePath) {
  try {
    return JSON.parse(fs.readFileSync(domainFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function domainSlug(domainKey) {
  return String(domainKey || '').replace(/^domain_/, '');
}

function loadOntologyMaps(ontologyRoot) {
  const indexPath = path.join(ontologyRoot || '', '.claude', 'ontology', 'index.json');
  if (!ontologyRoot || !fs.existsSync(indexPath)) {
    return { fileMap: {}, domainMap: {} };
  }

  try {
    const content = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const fileMap = {};
    const domainMap = {};

    const isSplit = content.domains && typeof content.domains === 'object';
    const entries = isSplit
      ? Object.entries(content.domains).map(([domainKey, refPath]) => {
          const absPath = path.isAbsolute(refPath)
            ? refPath
            : path.join(ontologyRoot, refPath);
          const domainData = loadDomainFile(absPath) || {};
          return [domainKey, domainData];
        })
      : Object.entries(content).filter(([key]) => !key.startsWith('$'));

    for (const [domainKey, entry] of entries) {
      if (!entry || typeof entry !== 'object') continue;

      const normalizedEntry = { domainKey, ...entry };
      domainMap[domainKey] = normalizedEntry;

      for (const fileList of [entry.files, entry.source]) {
        if (!Array.isArray(fileList)) continue;
        for (const file of fileList) {
          fileMap[normalizeOntologyPath(file)] = normalizedEntry;
        }
      }

      const slug = domainSlug(domainKey);
      if (slug) {
        fileMap[`__slug__${normalizeOntologyPath(slug)}`] = normalizedEntry;
      }
    }

    return { fileMap, domainMap };
  } catch {
    return { fileMap: {}, domainMap: {} };
  }
}

function matchFileToDomain({ filePath, ontologyRoot, fileMap }) {
  if (!filePath || !ontologyRoot || !fileMap) return null;

  const normalizedFilePath = normalizeOntologyPath(filePath);
  const relativeToRoot = normalizeOntologyPath(path.relative(ontologyRoot, path.resolve(filePath)));
  if (!relativeToRoot || relativeToRoot === '..' || relativeToRoot.startsWith('../')) {
    return null;
  }

  const exactMatch = fileMap[relativeToRoot] || fileMap[normalizedFilePath];
  if (exactMatch) return exactMatch;

  const prefixMatch = Object.entries(fileMap).find(([key]) =>
    !key.startsWith('__slug__') &&
    key.endsWith('/') &&
    relativeToRoot.startsWith(key)
  )?.[1];
  if (prefixMatch) return prefixMatch;

  const slugMatch = Object.entries(fileMap).find(([key]) => {
    if (!key.startsWith('__slug__')) return false;
    const slug = key.slice('__slug__'.length);
    return relativeToRoot.split('/').includes(slug);
  })?.[1] || null;

  return slugMatch;
}

module.exports = {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
};
