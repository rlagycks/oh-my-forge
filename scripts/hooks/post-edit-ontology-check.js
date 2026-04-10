#!/usr/bin/env node
/**
 * PostToolUse Hook: Ontology Sync Validator
 *
 * Fires after Edit/Write/MultiEdit. If the edited file is either:
 *   - .claude/ontology/index.json
 *   - docs/features/*.md (any spec file)
 *
 * …runs scripts/ci/validate-ontology.js and surfaces any failures as
 * an inline warning via stderr so Claude can act before the session ends.
 *
 * Always exits 0 — never blocks tool execution.
 *
 * Profile: standard,strict
 * Trigger: PostToolUse on Edit|Write|MultiEdit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Paths that should trigger ontology validation (relative to project root).
// Matched against the resolved file path using string suffix or regex.
const ONTOLOGY_INDEX_REL = path.join('.claude', 'ontology', 'index.json');
const FEATURES_DIR_REL = path.join('docs', 'features');

/**
 * Resolve the project root by walking up from a file path or cwd,
 * looking for the .claude/ontology/index.json marker.
 * @param {string} filePath
 * @returns {string|null}
 */
function resolveProjectRoot(filePath) {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT || '';
  if (envRoot) {
    const marker = path.join(envRoot, '.claude', 'ontology', 'index.json');
    if (fs.existsSync(marker)) return path.resolve(envRoot);
  }

  // Walk up from the edited file
  if (filePath) {
    let dir = path.resolve(path.dirname(filePath));
    const fsRoot = path.parse(dir).root;
    for (let depth = 0; dir !== fsRoot && depth < 12; depth++) {
      if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
      dir = path.dirname(dir);
    }
  }

  // Walk up from cwd
  let dir = process.cwd();
  const fsRoot = path.parse(dir).root;
  for (let depth = 0; dir !== fsRoot && depth < 12; depth++) {
    if (fs.existsSync(path.join(dir, '.claude', 'ontology', 'index.json'))) return dir;
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Determine whether a file path should trigger ontology validation.
 * @param {string} resolvedFile  Absolute path to the edited file.
 * @param {string} projectRoot   Absolute path to the project root.
 * @returns {boolean}
 */
function isOntologyFile(resolvedFile, projectRoot) {
  const rel = path.relative(projectRoot, resolvedFile);
  // index.json exact match
  if (rel === ONTOLOGY_INDEX_REL) return true;
  // any docs/features/*.md (not subdirectories)
  if (
    rel.startsWith(FEATURES_DIR_REL + path.sep) &&
    rel.endsWith('.md') &&
    !rel.slice(FEATURES_DIR_REL.length + 1).includes(path.sep)
  ) {
    return true;
  }
  return false;
}

/**
 * Main hook function called by run-with-flags.js.
 * @param {string} rawInput  Raw stdin JSON from Claude Code.
 * @returns {string}  Always returns rawInput (pass-through hook).
 */
function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  // Extract the file path from the tool input.
  // Edit → file_path, Write → file_path, MultiEdit → file_path or path
  const filePath =
    input.tool_input?.file_path ||
    input.tool_input?.path ||
    '';

  if (!filePath) return rawInput;

  const projectRoot = resolveProjectRoot(filePath);
  if (!projectRoot) return rawInput;

  const resolvedFile = path.resolve(filePath);
  if (!isOntologyFile(resolvedFile, projectRoot)) return rawInput;

  // The edited file is an ontology file — run the validator.
  const validatorPath = path.join(projectRoot, 'scripts', 'ci', 'validate-ontology.js');
  if (!fs.existsSync(validatorPath)) return rawInput;

  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15000,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const exitCode = result.status;

  if (exitCode !== 0) {
    const lines = [
      '',
      '[ontology-check] validate-ontology.js FAILED after editing ' + path.relative(projectRoot, resolvedFile),
      stdout || stderr,
      'Run: node scripts/ci/validate-ontology.js',
      '',
    ];
    process.stderr.write(lines.join('\n'));
  }
  // On success, stay silent — no noise when everything is fine.

  return rawInput; // always pass through
}

module.exports = { run };

// Direct execution fallback (for testing)
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    const result = run(data);
    process.stdout.write(result);
    process.exit(0);
  });
}
