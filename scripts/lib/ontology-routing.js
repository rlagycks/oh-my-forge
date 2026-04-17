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

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(value => typeof value === 'string' && value.trim().length > 0)));
}

function normalizeSourceDocs(sourceDocs = {}) {
  if (!sourceDocs || typeof sourceDocs !== 'object' || Array.isArray(sourceDocs)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(sourceDocs)
      .map(([kind, docs]) => [kind, uniqueStrings(Array.isArray(docs) ? docs : [])])
      .filter(([, docs]) => docs.length > 0)
  );
}

function flattenSourceDocs(sourceDocs = {}) {
  return uniqueStrings(Object.values(normalizeSourceDocs(sourceDocs)).flat());
}

function mergeSourceDocs(base = {}, incoming = {}) {
  const normalizedBase = normalizeSourceDocs(base);
  const normalizedIncoming = normalizeSourceDocs(incoming);
  const merged = {};
  const keys = uniqueStrings([
    ...Object.keys(normalizedBase),
    ...Object.keys(normalizedIncoming),
  ]);

  for (const key of keys) {
    const docs = uniqueStrings([
      ...(normalizedBase[key] || []),
      ...(normalizedIncoming[key] || []),
    ]);
    if (docs.length > 0) merged[key] = docs;
  }

  return merged;
}

function mergeEntryWithDetail(entry, detailData = {}) {
  if (!detailData || typeof detailData !== 'object') {
    return entry;
  }

  const sourceDocs = mergeSourceDocs(entry.sourceDocs, detailData.sourceDocs);

  return {
    ...entry,
    ...detailData,
    files: entry.files,
    spec: entry.spec,
    detail: entry.detail,
    ...(Object.keys(sourceDocs).length > 0 ? { sourceDocs } : {}),
    summary: entry.summary || detailData.summary,
    owner: entry.owner || detailData.owner,
    codexWorkerHint: entry.codexWorkerHint || detailData.codexWorkerHint,
    riskLevel: entry.riskLevel || detailData.riskLevel,
    constraints: uniqueStrings([...(entry.constraints || []), ...(detailData.constraints || [])]),
    dependsOn: uniqueStrings([...(entry.dependsOn || []), ...(detailData.dependsOn || [])]),
    symbols: uniqueStrings([...(entry.symbols || []), ...(detailData.symbols || [])]),
  };
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
      : Object.entries(content)
        .filter(([key]) => !key.startsWith('$'))
        .map(([domainKey, entry]) => {
          if (!entry || typeof entry !== 'object' || !entry.detail) {
            return [domainKey, entry];
          }

          const detailPath = path.isAbsolute(entry.detail)
            ? entry.detail
            : path.join(ontologyRoot, entry.detail);
          return [domainKey, mergeEntryWithDetail(entry, loadDomainFile(detailPath))];
        });

    for (const [domainKey, entry] of entries) {
      if (!entry || typeof entry !== 'object') continue;

      const normalizedEntry = { domainKey, ...entry };
      domainMap[domainKey] = normalizedEntry;

      for (const fileList of [entry.files, entry.source, flattenSourceDocs(entry.sourceDocs)]) {
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
  flattenSourceDocs,
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
  mergeSourceDocs,
  normalizeSourceDocs,
  uniqueStrings,
};
