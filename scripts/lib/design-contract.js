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

const REQUIRED_CONTRACT_FIELDS = [
  ['problemOneLine', 'Problem One Line', 'string'],
  ['mission', 'Mission', 'string'],
  ['success', 'Success', 'array'],
  ['notDo', 'Not Do', 'array'],
  ['inputsContracts', 'Inputs / Contracts', 'array'],
  ['verificationPoints', 'Verification Points', 'array'],
  ['falseNormalChecks', 'False-Normal Checks', 'array'],
  ['expansionForbidden', 'Expansion Forbidden', 'array'],
  ['handoffFormat', 'Handoff Format', 'array'],
];

const REQUIRED_HANDOFF_ITEMS = [
  'Current State',
  'Evidence',
  'Open Risks',
  'Next Action',
];
const SKIPPED_MARKDOWN_DIRS = new Set(['.git', 'node_modules']);

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

function hasItems(value) {
  return Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim().length > 0);
}

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function listIncludesLabel(items, label) {
  const normalizedLabel = normalizeHeading(label);
  return (items || []).some(item => normalizeHeading(item).includes(normalizedLabel));
}

function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object || {}, property);
}

function validateDesignContract(contract = {}) {
  const errors = [];
  const candidate = contract && typeof contract === 'object' ? contract : {};

  for (const [field, label, type] of REQUIRED_CONTRACT_FIELDS) {
    const value = candidate[field];
    const hasRequiredValue = hasOwnProperty(candidate, field) && (type === 'string' ? hasString(value) : hasItems(value));
    if (!hasRequiredValue) {
      errors.push(`Missing required design contract section: ${label}`);
    }
  }

  if (hasItems(candidate.handoffFormat)) {
    for (const item of REQUIRED_HANDOFF_ITEMS) {
      if (!listIncludesLabel(candidate.handoffFormat, item)) {
        errors.push(`Handoff Format must include: ${item}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function assertValidDesignContract(contract = {}) {
  const validation = validateDesignContract(contract);
  if (!validation.valid) {
    throw new Error(`Invalid design contract:\n- ${validation.errors.join('\n- ')}`);
  }
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

function isDesignContractMarkdownFile(filePath) {
  if (!String(filePath || '').toLowerCase().endsWith('.md')) return false;

  try {
    const markdown = readContractFile(filePath);
    if (/^#\s+Design Contract:/mi.test(markdown)) return true;

    const sections = splitSections(markdown);
    return Boolean(sections.problemOneLine && sections.handoffFormat);
  } catch {
    return false;
  }
}

function collectMarkdownFiles(dirPath) {
  const absPath = path.resolve(dirPath);
  if (!fs.existsSync(absPath)) return [];

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return [];
  }

  if (stat.isFile()) {
    return isDesignContractMarkdownFile(absPath) ? [absPath] : [];
  }
  if (!stat.isDirectory()) return [];

  const results = [];
  for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_MARKDOWN_DIRS.has(entry.name)) continue;

    const fullPath = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && isDesignContractMarkdownFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function validateDesignContractFile(filePath) {
  const absPath = path.resolve(filePath);
  try {
    const contract = parseDesignContract(readContractFile(absPath));
    const validation = validateDesignContract(contract);
    return {
      file: absPath,
      valid: validation.valid,
      errors: validation.errors,
    };
  } catch (err) {
    return {
      file: absPath,
      valid: false,
      errors: [err.message || String(err)],
    };
  }
}

function validateDesignContractFiles(filePaths = []) {
  const files = uniqueStrings(filePaths.map(filePath => path.resolve(filePath))).sort();
  const results = files.map(validateDesignContractFile);
  return {
    valid: results.every(result => result.valid),
    files: results,
  };
}

function parseCliFlags(args = []) {
  const options = {
    files: [],
    dirs: [],
    json: false,
  };

  const readFlagValue = (index, flag) => {
    const hasNext = Object.prototype.hasOwnProperty.call(args, index + 1);
    const value = hasNext ? args[index + 1] : undefined;
    if (!hasNext || String(value || '').startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--file') {
      options.files.push(readFlagValue(index, arg));
      index++;
    } else if (arg === '--dir') {
      options.dirs.push(readFlagValue(index, arg));
      index++;
    } else if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function collectFilesFromOptions(options = {}) {
  return uniqueStrings([
    ...(options.files || []),
    ...(options.dirs || []).flatMap(collectMarkdownFiles),
  ]).sort();
}

function printValidationReport(report) {
  const invalid = report.files.filter(file => !file.valid);
  console.log('Design contract validation');
  console.log(`Files: ${report.files.length}`);
  console.log(`Invalid: ${invalid.length}`);

  for (const result of report.files) {
    console.log(`- ${result.valid ? 'PASS' : 'FAIL'} ${result.file}`);
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
}

function runCli(argv = process.argv.slice(2)) {
  try {
    const [cmd, ...rest] = argv;
    if (cmd !== 'validate') {
      console.error('Usage: design-contract.js validate --file <path> [--file <path>] [--dir <dir>] [--json]');
      process.exit(1);
    }

    const options = parseCliFlags(rest);
    const files = collectFilesFromOptions(options);
    if (files.length === 0) {
      console.error('No design contract files found. Use --file <path> or --dir <dir>.');
      process.exit(1);
    }

    const report = validateDesignContractFiles(files);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printValidationReport(report);
    }

    if (!report.valid) {
      process.exit(1);
    }
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  assertValidDesignContract,
  buildOntologyDetailFragment,
  inferDomainFromDetailPath,
  mergeOntologyDetail,
  parseDesignContract,
  readContractFile,
  validateDesignContract,
  validateDesignContractFile,
  validateDesignContractFiles,
};

if (require.main === module) {
  runCli();
}
