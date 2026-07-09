#!/usr/bin/env node
/** PreToolUse Hook: block direct tracked edits when Codex is the pinned engine. */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveProjectOntologyRoot,
  loadOntologyMaps,
  matchFileToDomain,
} = require('../lib/ontology-routing');
const {
  detectPinnedImplementationEngine,
  readImplementationEngineValue,
  touchesImplementationEngine,
} = require('../lib/implementation-engine');
// Policy predicates shared with the Bash-side counterpart
// (scripts/hooks/pre-bash-codex-guard.js) so both tool paths give the same
// file the same verdict.
const {
  isCodexGuardBypassed,
  isMetaPath,
  isSelfRepoRoot,
} = require('../lib/codex-guard-policy');

function detectEngineMutation(input, resolvedFile) {
  const toolName = input.tool_name || '';
  const ti = input.tool_input || {};

  if (toolName === 'Write') {
    const currentText = fs.existsSync(resolvedFile) ? fs.readFileSync(resolvedFile, 'utf8') : '';
    const proposedText = ti.content || '';
    const current = readImplementationEngineValue(currentText);
    const proposed = readImplementationEngineValue(proposedText);
    if (!touchesImplementationEngine(proposedText) && current === proposed) return null;
    if (current === proposed && current !== null) return null;
    return { current, proposed };
  }

  const edits = toolName === 'MultiEdit'
    ? (Array.isArray(ti.edits) ? ti.edits : [])
    : [{ old_string: ti.old_string, new_string: ti.new_string }];

  for (const edit of edits) {
    const current = readImplementationEngineValue(edit?.old_string || '');
    const proposed = readImplementationEngineValue(edit?.new_string || '');
    if (!touchesImplementationEngine(edit?.old_string) && !touchesImplementationEngine(edit?.new_string)) continue;
    if (current === proposed && current !== null) continue;
    return { current, proposed };
  }

  return null;
}

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  // Escape hatch — honored symmetrically by pre-bash-codex-guard.js
  if (isCodexGuardBypassed()) return rawInput;

  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';
  if (!filePath) return rawInput;

  const ontologyRoot = resolveProjectOntologyRoot({ filePath });
  if (!ontologyRoot) return rawInput;

  const resolvedFile = path.resolve(filePath);
  const relPath = path.relative(ontologyRoot, resolvedFile);
  const normalizedRelPath = relPath.replace(/\\/g, '/');

  if (normalizedRelPath === '.claude/settings.json') {
    const mutation = detectEngineMutation(input, resolvedFile);
    if (mutation) {
      const sessionEngine = detectPinnedImplementationEngine(ontologyRoot);
      const current = mutation.current || sessionEngine || 'unset';
      const proposed = mutation.proposed || 'unset';
      const msg = [
        '',
        '[CODEX GUARD] implementationEngine change blocked',
        '',
        `  File    : ${normalizedRelPath}`,
        `  Engine  : ${current} -> ${proposed}`,
        '',
        '  implementationEngine is pinned for the current session.',
        '  Start a new session to switch engines, or set ECC_BYPASS_CODEX_GUARD=1',
        '  for an explicit operator override.',
        '',
      ].join('\n');
      process.stderr.write(msg);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: '[CODEX GUARD] implementationEngine cannot be changed during the current session.',
      }));
      process.exit(2);
    }
  }

  const isSelfRepo = isSelfRepoRoot(ontologyRoot);
  if (!isSelfRepo && isMetaPath(normalizedRelPath)) return rawInput;

  const { fileMap } = loadOntologyMaps(ontologyRoot);
  const domainKey = matchFileToDomain({ filePath, ontologyRoot, fileMap })?.domainKey || null;
  if (!domainKey) return rawInput;
  const engine = detectPinnedImplementationEngine(ontologyRoot);
  if (engine !== 'codex') return rawInput;

  const msg = [
    '',
    '[CODEX GUARD] Direct edit blocked — Codex-first policy active',
    '',
    `  File    : ${normalizedRelPath}`,
    `  Domain  : ${domainKey}`,
    '',
    '  Implementation tasks for ontology-tracked source files must go through Codex.',
    '  Use /codex-delegate to delegate this change, or set ECC_BYPASS_CODEX_GUARD=1',
    '  if you need to make a meta-level edit (hooks, skills, docs).',
    '',
    '  Quick delegation:',
    `    /codex-delegate ${domainKey}`,
    '',
  ].join('\n');

  process.stderr.write(msg);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `[CODEX GUARD] File "${normalizedRelPath}" is tracked by ${domainKey}. Use /codex-delegate instead.`,
  }));
  process.exit(2);
}

module.exports = { run };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    run(raw);
    process.exit(0);
  });
}
