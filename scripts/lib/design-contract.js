'use strict';

const fs = require('fs');
const path = require('path');
const { mergeSourceDocs, uniqueStrings } = require('./ontology-routing');

const SECTION_ALIASES = new Map([
  ['problem one line', 'problemOneLine'],
  ['mission', 'mission'],
  ['success', 'success'],
  ['not do', 'notDo'],
  ['inputs contracts', 'inputsContracts'],
  ['verification points', 'verificationPoints'],
  ['false normal checks', 'falseNormalChecks'],
  ['expansion forbidden', 'expansionForbidden'],
  ['handoff format', 'handoffFormat'],
  ['open assumptions', 'openAssumptions'],
]);

function normalizeHeading(heading) {
  return String(heading || '')
    .replace(/[`*_]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function readContractFile(filePath) {
  const absPath = path.resolve(filePath);
  return fs.readFileSync(absPath, 'utf8');
}

function splitSections(markdown) {
  const text = String(markdown || '');
  const sectionRegex = /^(#{2,3})\s+(.+?)\s*$/gm;
  const matches = [...text.matchAll(sectionRegex)];
  const sections = {};

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const heading = match[2];
    const key = SECTION_ALIASES.get(normalizeHeading(heading));
    if (!key) continue;

    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    sections[key] = text.slice(start, end).trim();
  }

  return sections;
}

function stripListPrefix(line) {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

function extractItems(sectionText) {
  const lines = String(sectionText || '').split('\n');
  const items = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s+/.test(line)) continue;

    const normalized = stripListPrefix(line);
    if (normalized) {
      items.push(normalized);
    }
  }

  return uniqueStrings(items);
}

function extractSingle(sectionText) {
  return extractItems(sectionText)[0] || '';
}

function parseDesignContract(markdown) {
  const sections = splitSections(markdown);

  return {
    problemOneLine: extractSingle(sections.problemOneLine),
    mission: extractItems(sections.mission).join(' '),
    success: extractItems(sections.success),
    notDo: extractItems(sections.notDo),
    inputsContracts: extractItems(sections.inputsContracts),
    verificationPoints: extractItems(sections.verificationPoints),
    falseNormalChecks: extractItems(sections.falseNormalChecks),
    expansionForbidden: extractItems(sections.expansionForbidden),
    handoffFormat: extractItems(sections.handoffFormat),
    openAssumptions: extractItems(sections.openAssumptions),
  };
}

function buildOntologyDetailFragment(contract = {}, options = {}) {
  const sourcePath = typeof options.source === 'string' && options.source.trim().length > 0
    ? options.source.trim()
    : typeof options.contractFile === 'string' && options.contractFile.trim().length > 0
      ? options.contractFile.trim()
      : '';
  const notDo = uniqueStrings([
    ...(contract.notDo || []),
    ...(contract.expansionForbidden || []),
  ]);
  const constraints = uniqueStrings(contract.inputsContracts || []);
  const summary = typeof options.summary === 'string' && options.summary.trim().length > 0
    ? options.summary.trim()
    : contract.problemOneLine || '';

  return {
    ...(typeof options.domain === 'string' && options.domain.trim().length > 0 ? { domain: options.domain.trim() } : {}),
    ...(typeof options.version === 'string' && options.version.trim().length > 0 ? { version: options.version.trim() } : {}),
    ...(summary ? { summary } : {}),
    ...(sourcePath ? { source: [sourcePath] } : {}),
    ...(sourcePath ? { sourceDocs: { designContract: [sourcePath] } } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    executionContract: {
      ...(contract.mission ? { mission: contract.mission } : {}),
      ...(contract.success?.length ? { success: contract.success } : {}),
      ...(notDo.length ? { notDo } : {}),
    },
    completionContract: {
      ...(contract.verificationPoints?.length ? { requiredEvidence: contract.verificationPoints } : {}),
      ...(contract.falseNormalChecks?.length ? { falseNormalChecks: contract.falseNormalChecks } : {}),
      ...(contract.handoffFormat?.length ? { handoffTemplate: contract.handoffFormat } : {}),
    },
  };
}

function mergeStringArrays(base, incoming) {
  return uniqueStrings([...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

function mergeOntologyDetail(existing = {}, fragment = {}) {
  const merged = {
    ...existing,
    ...fragment,
  };

  if (existing.source || fragment.source) {
    merged.source = mergeStringArrays(existing.source, fragment.source);
  }

  if (existing.sourceDocs || fragment.sourceDocs) {
    merged.sourceDocs = mergeSourceDocs(existing.sourceDocs, fragment.sourceDocs);
  }

  if (existing.constraints || fragment.constraints) {
    merged.constraints = mergeStringArrays(existing.constraints, fragment.constraints);
  }

  if (existing.summary && !fragment.summary) {
    merged.summary = existing.summary;
  }

  const executionContract = {
    ...(existing.executionContract || {}),
    ...(fragment.executionContract || {}),
  };
  if (existing.executionContract?.notDo || fragment.executionContract?.notDo) {
    executionContract.notDo = mergeStringArrays(existing.executionContract?.notDo, fragment.executionContract?.notDo);
  }
  if (existing.executionContract?.success || fragment.executionContract?.success) {
    executionContract.success = mergeStringArrays(existing.executionContract?.success, fragment.executionContract?.success);
  }
  if (existing.executionContract?.approvalBoundary || fragment.executionContract?.approvalBoundary) {
    executionContract.approvalBoundary = mergeStringArrays(
      existing.executionContract?.approvalBoundary,
      fragment.executionContract?.approvalBoundary
    );
  }
  if (existing.executionContract?.blockOn || fragment.executionContract?.blockOn) {
    executionContract.blockOn = mergeStringArrays(existing.executionContract?.blockOn, fragment.executionContract?.blockOn);
  }
  if (Object.keys(executionContract).length > 0) {
    merged.executionContract = executionContract;
  }

  const completionContract = {
    ...(existing.completionContract || {}),
    ...(fragment.completionContract || {}),
  };
  if (existing.completionContract?.requiredEvidence || fragment.completionContract?.requiredEvidence) {
    completionContract.requiredEvidence = mergeStringArrays(
      existing.completionContract?.requiredEvidence,
      fragment.completionContract?.requiredEvidence
    );
  }
  if (existing.completionContract?.falseNormalChecks || fragment.completionContract?.falseNormalChecks) {
    completionContract.falseNormalChecks = mergeStringArrays(
      existing.completionContract?.falseNormalChecks,
      fragment.completionContract?.falseNormalChecks
    );
  }
  if (existing.completionContract?.handoffTemplate || fragment.completionContract?.handoffTemplate) {
    completionContract.handoffTemplate = mergeStringArrays(
      existing.completionContract?.handoffTemplate,
      fragment.completionContract?.handoffTemplate
    );
  }
  if (Object.keys(completionContract).length > 0) {
    merged.completionContract = completionContract;
  }

  return merged;
}

function inferDomainFromDetailPath(detailFile) {
  const match = path.basename(String(detailFile || '')).match(/^(domain_[a-z0-9_]+)\.json$/);
  return match ? match[1] : '';
}

module.exports = {
  buildOntologyDetailFragment,
  inferDomainFromDetailPath,
  mergeOntologyDetail,
  parseDesignContract,
  readContractFile,
};
