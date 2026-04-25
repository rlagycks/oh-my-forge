'use strict';

/**
 * Plan workflow helper:
 * - Extract file paths from a confirmed plan (markdown)
 * - Save the plan to ~/.claude/plans/
 * - Route the file list against the project-local ontology
 * - Optionally dispatch Codex handoffs via the shared runtime
 *
 * This exists to remove the manual (error-prone) "extract file paths" step
 * described in commands/plan.md and skills/plan.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { savePlan } = require('./save-plan');
const { detectImplementationEngine } = require('./utils');
const { createPlanRoute, dispatchHandoff } = require('./codex-handoff');

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(value => typeof value === 'string' && value.trim().length > 0)));
}

function stripWrappingPunctuation(value) {
  return String(value || '')
    .trim()
    .replace(/^[('"`]+/, '')
    .replace(/[)"'`,.;:]+$/g, '')
    .trim();
}

function looksLikeProjectPath(value) {
  const candidate = stripWrappingPunctuation(value);
  if (!candidate) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (candidate.startsWith('#')) return false;
  if (candidate.includes('\n')) return false;
  if (candidate.length > 240) return false;
  if (candidate.includes('`')) return false;
  if (/^\-\-?[a-zA-Z0-9_-]+$/.test(candidate)) return false;

  // Must include at least one path-ish signal.
  if (!candidate.includes('/') && !candidate.includes('\\') && !candidate.includes('.')) return false;

  // Avoid obviously non-file tokens.
  if (/^\w+:$/.test(candidate)) return false; // "Files:" etc.
  if (/^[A-Z_]{3,}$/.test(candidate)) return false; // ENV_VAR style

  return true;
}

function normalizeToPosix(value) {
  return stripWrappingPunctuation(value).replace(/\\/g, '/');
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function extractBacktickedPaths(markdown) {
  const candidates = [];
  const text = String(markdown || '');
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(text))) {
    candidates.push(match[1]);
  }
  return candidates;
}

function extractFileLabelPaths(markdown) {
  const candidates = [];
  const text = String(markdown || '');
  // Examples:
  //   (File: src/app.ts)
  //   File: src/app.ts
  //   Files: src/a.ts, src/b.ts
  const regex = /\bFiles?\s*:\s*([^\n)]+)/gi;
  let match;
  while ((match = regex.exec(text))) {
    candidates.push(...splitCsv(match[1]));
  }
  return candidates;
}

function extractBarePathTokens(markdown) {
  const candidates = [];
  const text = String(markdown || '');

  // Conservative: only tokens that already contain a slash.
  const tokens = text
    .split(/\s+/g)
    .map(token => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (!token.includes('/') && !token.includes('\\')) continue;
    candidates.push(token);
  }

  return candidates;
}

function filterAndNormalizeCandidates(candidates, routingRoot) {
  const root = path.resolve(routingRoot || process.cwd());

  const normalized = uniqueStrings(candidates)
    .map(normalizeToPosix)
    .filter(looksLikeProjectPath);

  const exists = [];
  const unknown = [];

  for (const candidate of normalized) {
    const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    if (fs.existsSync(abs)) exists.push(candidate);
    else unknown.push(candidate);
  }

  // Prefer existing files first, then keep unknown (they may be planned new files).
  return uniqueStrings([...exists, ...unknown]);
}

function extractPlanFiles(markdown, options = {}) {
  const routingRoot = options.routingRoot || process.cwd();

  const candidates = [
    ...extractFileLabelPaths(markdown),
    ...extractBacktickedPaths(markdown),
    ...extractBarePathTokens(markdown),
  ];

  return filterAndNormalizeCandidates(candidates, routingRoot);
}

function readFlag(flagName, argv) {
  const index = argv.indexOf(flagName);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function hasFlag(flagName, argv) {
  return argv.includes(flagName);
}

function readInputMarkdown(argv) {
  const planFile = readFlag('--plan-file', argv);
  if (planFile) {
    return fs.readFileSync(planFile, 'utf8');
  }

  const contentFlag = readFlag('--content', argv);
  if (contentFlag) return contentFlag;

  return fs.readFileSync('/dev/stdin', 'utf8');
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function writeTempJson(payload, options = {}) {
  const tempRoot = options.tempRoot || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(tempRoot, 'plan-workflow-'));
  const filePath = path.join(dir, 'handoff-request.json');
  fs.writeFileSync(filePath, safeJson(payload) + '\n', 'utf8');
  return { dir, filePath };
}

function runDelegate(argv) {
  const routingRoot = path.resolve(readFlag('--routing-root', argv) || process.cwd());
  const task = readFlag('--task', argv);
  if (!task) throw new Error('delegate requires --task "<one sentence task>"');

  const explicitEngine = readFlag('--engine', argv);
  const engine = explicitEngine === 'claude' || explicitEngine === 'codex'
    ? explicitEngine
    : detectImplementationEngine();

  const markdown = readInputMarkdown(argv);
  const featureName = readFlag('--feature-name', argv) || undefined;
  const shouldSave = !hasFlag('--no-save', argv);
  const planFile = shouldSave
    ? savePlan({ content: markdown, name: featureName })
    : (readFlag('--saved-plan-file', argv) || undefined);

  const explicitFiles = readFlag('--files', argv);
  const files = explicitFiles
    ? splitCsv(explicitFiles)
    : extractPlanFiles(markdown, { routingRoot });

  const mode = readFlag('--mode', argv) || 'foreground';
  const route = createPlanRoute({
    engine,
    routingRoot,
    planFile,
    featureName,
    task,
    mode,
    files,
    source: 'plan-auto',
  });

  const routeOnly = hasFlag('--route-only', argv);
  if (routeOnly || engine !== 'codex') {
    process.stdout.write(safeJson({ planFile, engine, files, route }) + '\n');
    return route.state === 'ROUTED' ? 0 : 1;
  }

  if (!Array.isArray(route.handoffs) || route.handoffs.length === 0) {
    process.stdout.write(safeJson({ planFile, engine, files, route, results: [] }) + '\n');
    return 1;
  }

  const results = [];
  let anyBlocked = false;

  for (const handoff of route.handoffs) {
    const { dir, filePath } = writeTempJson(handoff);
    try {
      const result = dispatchHandoff({ request: handoff });
      results.push({ requestFile: filePath, result });
      if (result.state !== 'COMPLETED') anyBlocked = true;
    } catch (error) {
      anyBlocked = true;
      results.push({ requestFile: filePath, error: error.message });
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  process.stdout.write(safeJson({ planFile, engine, files, route, results }) + '\n');
  return anyBlocked ? 1 : 0;
}

function runExtractFiles(argv) {
  const routingRoot = path.resolve(readFlag('--routing-root', argv) || process.cwd());
  const markdown = readInputMarkdown(argv);
  const files = extractPlanFiles(markdown, { routingRoot });
  process.stdout.write(safeJson({ routingRoot, files }) + '\n');
  return files.length > 0 ? 0 : 1;
}

function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  try {
    if (command === 'extract-files') {
      process.exit(runExtractFiles(argv.slice(1)));
    }

    if (command === 'delegate') {
      process.exit(runDelegate(argv.slice(1)));
    }

    process.stderr.write(
      'Usage:\n' +
      '  node scripts/lib/plan-workflow.js extract-files [--routing-root <dir>] [--plan-file <md>] [--content <md>]\n' +
      '  node scripts/lib/plan-workflow.js delegate --task <text> [--feature-name <name>] [--engine codex|claude] [--routing-root <dir>]\n' +
      '       [--files a,b] [--mode foreground|background] [--plan-file <md>] [--content <md>] [--no-save] [--saved-plan-file <path>] [--route-only]\n'
    );
    process.exit(1);
  } catch (error) {
    process.stderr.write(`[plan-workflow] Error: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  extractPlanFiles,
};

if (require.main === module) {
  runCli();
}

