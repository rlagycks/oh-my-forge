#!/usr/bin/env node
/**
 * PreToolUse Hook: QA Context Injection
 *
 * When an agent edits a file that appears in docs/qa/bug-topology.md,
 * this hook injects the relevant bug history as a warning so the agent
 * knows what bugs were previously found in that file.
 *
 * Trigger: PreToolUse on Edit|Write|MultiEdit
 * Profile: standard,strict
 * Token cost: ~0 when no match, ~200-400 when match found (per file)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectOntologyRoot } = require('../lib/ontology-routing');

const _MAX_STDIN = 512 * 1024;

/**
 * Parse bug-topology.md to extract the JSON map section.
 * Returns an object like { "src/components/Foo.tsx": ["QA-001"] }
 * Returns {} if the file is missing or the map is empty.
 */
function loadBugTopology(pluginRoot) {
  const topologyPath = path.join(pluginRoot, 'docs', 'qa', 'bug-topology.md');
  if (!fs.existsSync(topologyPath)) return {};

  try {
    const content = fs.readFileSync(topologyPath, 'utf8');
    // Extract the JSON code block after "## File → Bug Map"
    const match = content.match(/## File → Bug Map[\s\S]*?```json\s*([\s\S]*?)```/);
    if (!match) return {};
    const parsed = JSON.parse(match[1].trim());
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Extract bug records for given IDs from bug-topology.md
 * Returns a markdown string summarising each bug.
 */
function extractBugDetails(pluginRoot, bugIds) {
  const topologyPath = path.join(pluginRoot, 'docs', 'qa', 'bug-topology.md');
  if (!fs.existsSync(topologyPath)) return '';

  try {
    const content = fs.readFileSync(topologyPath, 'utf8');
    const lines = content.split('\n');
    const results = [];

    for (const id of bugIds) {
      // Find rows in the Active Bugs or Resolved Bugs tables that start with | ID |
      const row = lines.find(l => l.startsWith(`| ${id} |`));
      if (row) {
        results.push(row.trim());
      }
    }

    return results.join('\n');
  } catch {
    return '';
  }
}

/**
 * Main hook function — receives raw stdin JSON from run-with-flags.js
 */
function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput; // pass through on parse error
  }

  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';
  if (!filePath) return rawInput;

  const ontologyRoot = resolveProjectOntologyRoot({ filePath });
  if (!ontologyRoot) return rawInput;

  const bugMap = loadBugTopology(ontologyRoot);
  if (!bugMap || Object.keys(bugMap).length === 0) return rawInput;

  // Normalize the file path to be relative to the project ontology root.
  const resolvedFile = path.resolve(filePath);
  const relativeToRoot = path.relative(ontologyRoot, resolvedFile);

  // Check if this file has bug history — try both the relative path and original path
  const bugIds =
    bugMap[relativeToRoot] ||
    bugMap[filePath] ||
    bugMap[path.basename(filePath)] ||
    null;

  if (!bugIds || bugIds.length === 0) return rawInput;

  // Found matching bugs — inject context as a stderr warning
  // Claude Code surfaces stderr from PreToolUse hooks as inline context
  const details = extractBugDetails(ontologyRoot, bugIds);
  const msg = [
    `[QA] Bug history found for ${path.basename(filePath)}`,
    `Known issues (from docs/qa/bug-topology.md):`,
    details || bugIds.map(id => `  - ${id}`).join('\n'),
    `Review these before editing. See docs/qa/rca-history/ for full context.`,
    '',
  ].join('\n');

  process.stderr.write(msg);

  return rawInput; // always pass through — this hook never blocks
}

// Entry point: run-with-flags.js calls run(rawInput) and writes the return value to stdout
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
