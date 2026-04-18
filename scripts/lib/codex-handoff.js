'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Ajv = require('ajv');
const { resolveCodexCompanionPath } = require('./resolve-codex-companion');
const {
  COMPLETION_REPORT_FIELDS,
  FALSE_NORMAL_DETECTOR_RULE,
  parseCompletionResult,
} = require('./false-normal-detector');

const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
  normalizeSourceDocs,
  uniqueStrings,
} = require('./ontology-routing');
const {
  buildContractFieldsFromPacket,
  buildDomainPacket,
} = require('./ontology-packet');

const REQUEST_SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'codex-handoff-request.schema.json');
const RESULT_SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'codex-handoff-result.schema.json');

let cachedAjv = null;
let cachedRequestValidator = null;
let cachedResultValidator = null;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function getAjv() {
  if (cachedAjv) {
    return cachedAjv;
  }

  cachedAjv = new Ajv({
    allErrors: true,
    strict: false,
  });
  return cachedAjv;
}

function getRequestValidator() {
  if (cachedRequestValidator) {
    return cachedRequestValidator;
  }

  cachedRequestValidator = getAjv().compile(readJson(REQUEST_SCHEMA_PATH, 'codex handoff request schema'));
  return cachedRequestValidator;
}

function getResultValidator() {
  if (cachedResultValidator) {
    return cachedResultValidator;
  }

  cachedResultValidator = getAjv().compile(readJson(RESULT_SCHEMA_PATH, 'codex handoff result schema'));
  return cachedResultValidator;
}

function formatValidationErrors(errors = []) {
  return errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function normalizeChecklist(values, fallback = []) {
  const normalized = uniqueStrings(values);
  return normalized.length > 0 ? normalized : uniqueStrings(fallback);
}

function normalizeProjectFile(filePath, routingRoot) {
  const resolvedRoot = path.resolve(routingRoot || process.cwd());
  const resolvedFile = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolvedRoot, filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);

  if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return relative.replace(/\\/g, '/');
  }

  return resolvedFile.replace(/\\/g, '/');
}

function normalizeFiles(files, routingRoot) {
  return uniqueStrings(files).map(filePath => normalizeProjectFile(filePath, routingRoot));
}

function normalizeModels(models) {
  return uniqueStrings((models || []).map(model => {
    if (typeof model === 'string') return model;
    if (model && typeof model.name === 'string') return model.name;
    return '';
  }));
}

function normalizeEndpoints(endpoints) {
  return uniqueStrings((endpoints || []).map(endpoint => {
    if (typeof endpoint === 'string') return endpoint;
    if (!endpoint || typeof endpoint !== 'object') return '';

    const method = typeof endpoint.method === 'string' ? endpoint.method : '';
    const routePath = typeof endpoint.path === 'string' ? endpoint.path : '';
    const summary = typeof endpoint.summary === 'string' && endpoint.summary.trim().length > 0
      ? ` - ${endpoint.summary}`
      : '';
    const line = `${method} ${routePath}`.trim();
    return line ? `${line}${summary}` : '';
  }));
}

function sourceDocsEntries(sourceDocs = {}) {
  return Object.entries(normalizeSourceDocs(sourceDocs));
}

function formatSourceDocs(sourceDocs = {}) {
  const entries = sourceDocsEntries(sourceDocs);
  if (entries.length === 0) {
    return 'N/A';
  }

  return entries
    .map(([kind, docs]) => `${kind}=${docs.join(',')}`)
    .join(' | ');
}

function defaultCompletionChecks(options = {}) {
  return [
    'Do not claim RESULT:DONE from TESTS: PASS alone.',
    'Report concrete evidence tied to the changed files.',
    'State what was checked to avoid false-normal completion.',
    options.write === false
      ? 'Give the next reader action if the task is blocked or partial.'
      : 'Give the next operator action if the task is blocked or partial.',
  ];
}

function buildContractFields(entry = {}, profileName = 'implement') {
  const packet = buildDomainPacket(entry, profileName);
  const fields = buildContractFieldsFromPacket(packet);

  return {
    successCriteria: normalizeChecklist(fields.successCriteria),
    notDo: normalizeChecklist(fields.notDo),
    completionChecks: normalizeChecklist(fields.completionChecks),
  };
}

function validateWith(validator, payload) {
  const valid = validator(payload);
  return {
    valid,
    errors: validator.errors || [],
    error: valid ? null : formatValidationErrors(validator.errors || []),
  };
}

function validateHandoff(payload) {
  return validateWith(getRequestValidator(), payload);
}

function validateResult(payload) {
  return validateWith(getResultValidator(), payload);
}

function assertValidHandoff(payload, label) {
  const validation = validateHandoff(payload);
  if (!validation.valid) {
    throw new Error(`Invalid codex handoff${label ? ` (${label})` : ''}: ${validation.error}`);
  }
}

function assertValidResult(payload, label) {
  const validation = validateResult(payload);
  if (!validation.valid) {
    throw new Error(`Invalid codex result${label ? ` (${label})` : ''}: ${validation.error}`);
  }
}

function baseRequest(options = {}) {
  const kind = options.kind || 'fallback';
  const defaultSource = kind === 'domain' ? 'manual-delegate' : 'manual-rescue';
  const successCriteria = normalizeChecklist(options.successCriteria, [
    options.summary
      ? `Finish the scoped work for ${options.summary}.`
      : `Complete task: ${options.task}`,
  ]);
  const completionChecks = normalizeChecklist(options.completionChecks, defaultCompletionChecks(options));
  const notDo = uniqueStrings(options.notDo);
  const sourceDocs = normalizeSourceDocs(options.sourceDocs);
  return {
    schemaVersion: options.schemaVersion || 'ecc.codex.handoff.request.v2',
    state: options.state || 'ROUTED',
    engine: options.engine || 'codex',
    source: options.source || defaultSource,
    mode: options.mode || 'foreground',
    write: options.write === false ? false : true,
    routingRoot: path.resolve(options.routingRoot || process.cwd()),
    planFile: options.planFile,
    task: options.task,
    problemOneLine: typeof options.problemOneLine === 'string' && options.problemOneLine.trim().length > 0
      ? options.problemOneLine.trim()
      : options.task,
    successCriteria,
    completionChecks,
    files: normalizeFiles(options.files, options.routingRoot || process.cwd()),
    ...(options.featureName ? { featureName: options.featureName } : {}),
    ...(options.summary ? { summary: options.summary } : {}),
    ...(notDo.length > 0 ? { notDo } : {}),
    ...(normalizeEndpoints(options.endpoints).length > 0 ? { endpoints: normalizeEndpoints(options.endpoints) } : {}),
    ...(normalizeModels(options.models).length > 0 ? { models: normalizeModels(options.models) } : {}),
    ...(uniqueStrings(options.symbols).length > 0 ? { symbols: uniqueStrings(options.symbols) } : {}),
    ...(uniqueStrings(options.constraints).length > 0 ? { constraints: uniqueStrings(options.constraints) } : {}),
    ...(uniqueStrings(options.dependsOn).length > 0 ? { dependsOn: uniqueStrings(options.dependsOn) } : {}),
    ...(Object.keys(sourceDocs).length > 0 ? { sourceDocs } : {}),
  };
}

function createDomainDelegation(options = {}) {
  const request = {
    ...baseRequest({ ...options, kind: 'domain' }),
    kind: 'domain',
    domainId: options.domainId,
  };
  assertValidHandoff(request, 'domain delegation');
  return request;
}

function createFallbackRescue(options = {}) {
  const request = {
    ...baseRequest({ ...options, kind: 'fallback' }),
    kind: 'fallback',
  };
  assertValidHandoff(request, 'fallback rescue');
  return request;
}

function buildBrief(request) {
  assertValidHandoff(request, 'buildBrief');
  const successCriteria = normalizeChecklist(request.successCriteria, [
    request.summary || request.task,
  ]);
  const notDo = normalizeChecklist(request.notDo, request.constraints || []);
  const completionChecks = normalizeChecklist(request.completionChecks, defaultCompletionChecks(request));

  const lines = [
    'BRIEF',
    '=====',
    `DOMAIN    : ${request.kind === 'domain' ? request.domainId : '_default'}`,
    `SOURCE    : ${request.source}`,
    `WRITE     : ${request.write ? 'true' : 'false'}`,
    `TASK      : ${request.task}`,
    `PROBLEM   : ${request.problemOneLine || request.task}`,
    `SUCCESS   : ${successCriteria.join(' | ')}`,
    `NOT DO    : ${notDo.join(' | ') || 'None'}`,
    `CHECKS    : ${completionChecks.join(' | ')}`,
    `FILES     : ${request.files.join(', ')}`,
    `ENDPOINTS : ${(request.endpoints || []).join(', ') || 'N/A'}`,
    `MODELS    : ${(request.models || []).join(', ') || 'N/A'}`,
    `SYMBOLS   : ${(request.symbols || []).join(', ') || 'N/A'}`,
    `CONSTRAINTS: ${(request.constraints || []).join(' | ') || 'None'}`,
    `DEPENDS ON: ${(request.dependsOn || []).join(', ') || 'none'}`,
    `SOURCE DOCS: ${formatSourceDocs(request.sourceDocs)} — load only when code/types do not contain the needed contract`,
    `PLAN FILE : ${request.planFile}`,
    `FALSE NORMAL DETECTOR: ${FALSE_NORMAL_DETECTOR_RULE}`,
    `HANDOFF   : Return: ${COMPLETION_REPORT_FIELDS.join(' / ')}`,
  ];

  return lines.join('\n');
}

function quoteShell(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function buildCompanionArgs(options = {}) {
  const request = options.request;
  assertValidHandoff(request, 'buildCompanionArgs');

  const promptFile = options.promptFile;
  if (!promptFile) {
    throw new Error('buildCompanionCommand requires promptFile');
  }

  const args = ['task'];

  if (request.kind === 'domain') {
    args.push('--domain-id', request.domainId);
  }

  if (request.mode === 'background') {
    args.push('--background');
  }

  if (options.fresh !== false) {
    args.push('--fresh');
  }

  if (request.write) {
    args.push('--write');
  }

  args.push('--prompt-file', promptFile);
  return args;
}

function buildCompanionCommand(options = {}) {
  const request = options.request;
  assertValidHandoff(request, 'buildCompanionCommand');

  const companionPath = options.companionPath;
  const promptFile = options.promptFile;
  if (!companionPath || !promptFile) {
    throw new Error('buildCompanionCommand requires companionPath and promptFile');
  }

  return [
    'node',
    quoteShell(companionPath),
    'task',
    ...(request.kind === 'domain' ? ['--domain-id', request.domainId] : []),
    ...(request.mode === 'background' ? ['--background'] : []),
    ...(options.fresh !== false ? ['--fresh'] : []),
    ...(request.write ? ['--write'] : []),
    '--prompt-file',
    quoteShell(promptFile),
  ].join(' ');
}

function dispatchHandoff(options = {}) {
  const request = options.request;
  assertValidHandoff(request, 'dispatchHandoff');

  if (request.engine !== 'codex') {
    throw new Error(`dispatchHandoff only supports codex engine requests (received ${request.engine})`);
  }

  const resolvedCompanion = resolveCodexCompanionPath({
    explicitPath: options.companionPath,
    envPath: process.env.CODEX_COMPANION_PATH,
    homeDir: options.homeDir,
    envRoot: options.envRoot,
    eccRoot: options.eccRoot,
  });
  const companionPath = resolvedCompanion.path;

  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const tempRoot = options.tempRoot || os.tmpdir();
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codex-handoff-'));
  const promptFile = path.join(tempDir, 'brief.txt');
  const spawnCwd = options.cwd || (fs.existsSync(request.routingRoot) ? request.routingRoot : process.cwd());

  try {
    fs.writeFileSync(promptFile, buildBrief(request), 'utf8');
    const args = [companionPath, ...buildCompanionArgs({
      request,
      promptFile,
      fresh: options.fresh,
    })];
    const result = spawnSyncImpl(process.execPath, args, {
      cwd: spawnCwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output = [result.stdout, result.stderr]
      .filter(value => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .trim();

    return parseCodexResult(output);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseCodexResult(output) {
  const result = parseCompletionResult(output, {
    schemaVersion: 'ecc.codex.handoff.result.v3',
    missingResultEvidence: 'Codex output did not contain a RESULT line.',
    missingResultCheck: 'Rejected completion because the RESULT line was missing.',
    missingResultSignal: 'Missing RESULT made the output look like a handoff but not an executable result.',
    missingResultNextAction: 'Inspect the blocked handoff output and re-run with a clearer contract.',
    missingResultSummary: 'Codex rescue returned no RESULT line.',
    missingResultError: 'Codex rescue returned no RESULT line.',
    falseNormalEvidence: 'False-normal detector rejected RESULT:DONE because required proof was missing.',
    falseNormalOpenRisk: 'Rejected RESULT:DONE until false-normal signals are resolved.',
    falseNormalNextAction: 'Provide TESTS, EVIDENCE, FALSE NORMAL CHECKS, FALSE NORMAL SIGNALS, and NEXT ACTION, then rerun the handoff parser.',
    falseNormalSummary: 'False-normal detector blocked completion.',
  });
  const label = result.reasonCode === 'missing-result'
    ? 'missing RESULT'
    : result.reasonCode === 'false-normal'
      ? 'false-normal detector'
      : 'parsed result';
  assertValidResult(result, label);
  return result;
}

function orderDomainKeys(domainGroups) {
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(domainKey) {
    if (visited.has(domainKey)) return;
    if (visiting.has(domainKey)) return;

    visiting.add(domainKey);
    const group = domainGroups.get(domainKey);
    const dependsOn = group?.entry?.dependsOn || [];
    for (const dep of dependsOn) {
      if (domainGroups.has(dep)) {
        visit(dep);
      }
    }
    visiting.delete(domainKey);
    visited.add(domainKey);
    ordered.push(domainKey);
  }

  for (const domainKey of domainGroups.keys()) {
    visit(domainKey);
  }

  return ordered;
}

function createPlanRoute(options = {}) {
  const engine = options.engine || 'codex';
  const routingRoot = path.resolve(options.routingRoot || process.cwd());
  const files = normalizeFiles(options.files, routingRoot);

  if (engine === 'claude') {
    return {
      schemaVersion: 'ecc.codex.handoff.route.v1',
      state: 'ROUTED',
      engine: 'claude',
      route: 'claude-inline',
      routingRoot,
      planFile: options.planFile,
      ontology: 'none',
      handoffs: [],
    };
  }

  if (files.length === 0) {
    return {
      schemaVersion: 'ecc.codex.handoff.route.v1',
      state: 'BLOCKED',
      engine,
      route: 'codex-handoffs',
      routingRoot,
      planFile: options.planFile,
      ontology: 'none',
      handoffs: [],
      reason: 'No file paths were provided for plan routing.',
    };
  }

  const ontologyRoot = resolveProjectOntologyRoot({ cwd: routingRoot });
  const { fileMap } = ontologyRoot ? loadOntologyMaps(ontologyRoot) : { fileMap: {} };
  const hasOntology = ontologyRoot && Object.keys(fileMap).length > 0;

  if (!hasOntology) {
    return {
      schemaVersion: 'ecc.codex.handoff.route.v1',
      state: 'ROUTED',
      engine,
      route: 'codex-handoffs',
      routingRoot,
      planFile: options.planFile,
      ontology: 'none',
      handoffs: [
        createFallbackRescue({
          engine,
          source: options.source || 'plan-auto',
          mode: options.mode,
          routingRoot,
          planFile: options.planFile,
          featureName: options.featureName,
          task: options.task,
          files,
        }),
      ],
    };
  }

  const domainGroups = new Map();
  const unmatchedFiles = [];

  for (const file of files) {
    const absoluteFile = path.isAbsolute(file) ? file : path.join(routingRoot, file);
    const entry = matchFileToDomain({
      filePath: absoluteFile,
      ontologyRoot,
      fileMap,
    });

    if (!entry) {
      unmatchedFiles.push(file);
      continue;
    }

    const current = domainGroups.get(entry.domainKey) || { entry, files: [] };
    current.files.push(file);
    domainGroups.set(entry.domainKey, current);
  }

  const handoffs = [];
  for (const domainKey of orderDomainKeys(domainGroups)) {
    const group = domainGroups.get(domainKey);
    const contractFields = buildContractFields(group.entry, 'implement');
    handoffs.push(createDomainDelegation({
      domainId: domainKey,
      engine,
      source: options.source || 'plan-auto',
      mode: options.mode,
      routingRoot,
      planFile: options.planFile,
      featureName: options.featureName,
      task: options.task,
      problemOneLine: options.task,
      files: group.files,
      summary: group.entry.summary,
      successCriteria: contractFields.successCriteria,
      notDo: contractFields.notDo,
      completionChecks: contractFields.completionChecks,
      endpoints: group.entry.endpoints,
      models: group.entry.models,
      symbols: group.entry.symbols,
      constraints: group.entry.constraints,
      dependsOn: group.entry.dependsOn,
      sourceDocs: group.entry.sourceDocs,
    }));
  }

  if (unmatchedFiles.length > 0) {
    handoffs.push(createFallbackRescue({
      engine,
      source: options.source || 'plan-auto',
      mode: options.mode,
      routingRoot,
      planFile: options.planFile,
      featureName: options.featureName,
      task: options.task,
      files: unmatchedFiles,
    }));
  }

  return {
    schemaVersion: 'ecc.codex.handoff.route.v1',
    state: 'ROUTED',
    engine,
    route: 'codex-handoffs',
    routingRoot,
    planFile: options.planFile,
    ontology: domainGroups.size > 0 ? 'project-local match' : 'none',
    handoffs,
  };
}

function formatImplementationSummary(route) {
  const lines = [
    'Implementation summary',
    '──────────────────────────────────────────',
    `State: ${route.state}`,
    `Engine: ${route.engine}`,
    `Routing root: ${route.routingRoot}`,
    `Plan saved: ${route.planFile}`,
    `Ontology: ${route.ontology}`,
  ];

  if (Array.isArray(route.handoffs)) {
    for (const handoff of route.handoffs) {
      if (handoff.kind === 'domain') {
        lines.push(`${handoff.domainId}    → /codex-delegate (${handoff.mode})`);
      } else {
        lines.push(`${handoff.files.join(', ')}    → /codex:rescue (${handoff.mode})`);
      }
    }
  }

  if (route.reason) {
    lines.push(`Reason: ${route.reason}`);
  }

  lines.push('──────────────────────────────────────────');
  return lines.join('\n');
}

function readInputFile(flagName, args) {
  const index = args.indexOf(flagName);
  if (index !== -1 && args[index + 1]) {
    return fs.readFileSync(args[index + 1], 'utf8');
  }

  return fs.readFileSync('/dev/stdin', 'utf8');
}

function readFlag(flagName, args) {
  const index = args.indexOf(flagName);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (command === 'route') {
    const route = createPlanRoute({
      engine: readFlag('--engine', argv) || 'codex',
      routingRoot: readFlag('--routing-root', argv) || process.cwd(),
      planFile: readFlag('--plan-file', argv),
      featureName: readFlag('--feature-name', argv) || undefined,
      task: readFlag('--task', argv),
      mode: readFlag('--mode', argv) || 'foreground',
      files: (readFlag('--files', argv) || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    });
    process.stdout.write(JSON.stringify(route, null, 2) + '\n');
    return;
  }

  if (command === 'build-brief') {
    const request = JSON.parse(readInputFile('--request-file', argv));
    process.stdout.write(buildBrief(request) + '\n');
    return;
  }

  if (command === 'parse-result') {
    const result = parseCodexResult(readInputFile('--result-file', argv));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (command === 'validate-request') {
    const request = JSON.parse(readInputFile('--request-file', argv));
    const validation = validateHandoff(request);
    process.stdout.write(JSON.stringify(validation, null, 2) + '\n');
    process.exit(validation.valid ? 0 : 1);
  }

  if (command === 'validate-result') {
    const result = JSON.parse(readInputFile('--result-file', argv));
    const validation = validateResult(result);
    process.stdout.write(JSON.stringify(validation, null, 2) + '\n');
    process.exit(validation.valid ? 0 : 1);
  }

  if (command === 'dispatch') {
    const request = JSON.parse(readInputFile('--request-file', argv));
    const result = dispatchHandoff({
      request,
      companionPath: readFlag('--companion-path', argv) || undefined,
      fresh: readFlag('--fresh', argv) === 'false' ? false : true,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.state === 'COMPLETED' ? 0 : 1);
  }

  process.stderr.write(
    'Usage:\n' +
    '  node scripts/lib/codex-handoff.js route --engine codex --routing-root <dir> --plan-file <file> --task <text> --files a,b\n' +
    '  node scripts/lib/codex-handoff.js build-brief --request-file <json>\n' +
    '  node scripts/lib/codex-handoff.js dispatch --request-file <json> [--companion-path <file>]\n' +
    '  node scripts/lib/codex-handoff.js parse-result --result-file <txt>\n' +
    '  node scripts/lib/codex-handoff.js validate-request --request-file <json>\n' +
    '  node scripts/lib/codex-handoff.js validate-result --result-file <json>\n'
  );
  process.exit(1);
}

module.exports = {
  buildContractFields,
  buildBrief,
  buildCompanionCommand,
  dispatchHandoff,
  createDomainDelegation,
  createFallbackRescue,
  createPlanRoute,
  formatImplementationSummary,
  parseCodexResult,
  validateHandoff,
  validateResult,
};

if (require.main === module) {
  runCli();
}
