#!/usr/bin/env node
/**
 * PostToolUse Hook: Commit RCA Trigger
 *
 * Fires after a Bash tool call. When a git commit or gh pr command is detected
 * with a "fix-type" prefix (fix:, fix(gap):, fix(design):, hotfix:), this hook:
 *
 *   1. Builds a context bundle (git diff, decisions, affected ontology domains)
 *   2. Writes the bundle to the shared RCA store:
 *        ~/.claude/rca/bundles/rca-bundle-<hash>.json
 *   3. Outputs hookSpecificOutput instructing Claude to spawn an isolated Agent
 *      running the /commit-rca skill to perform root-cause analysis and update
 *      the ontology constraints
 *
 * Convention that triggers RCA:
 *   fix:           → bug fix
 *   fix(gap):      → missing design element that caused a bug
 *   fix(design):   → design mistake corrected
 *   hotfix:        → urgent patch
 *
 * Conventions that do NOT trigger:
 *   feat:, refactor:, docs:, chore:, test:, perf:, ci:
 *
 * This also fires when a fix-titled PR is merged via `gh pr merge` (any
 * flags/order). The merged PR's title is resolved, in order of preference:
 *   1. Parsed from the `gh pr merge` command's own tool_response (gh prints
 *      the title in parentheses, e.g. "Merged pull request #42 (fix: ...)").
 *   2. The local HEAD commit subject (`git log -1 --format=%s`) — only
 *      meaningful when the merge happened against the current checkout.
 *   3. `gh pr view <ref> --json title` as a last resort, bounded to a short
 *      timeout so this PostToolUse hook never blocks noticeably.
 * Any failure along this path is silent — the hook always exits 0.
 *
 * Trigger:  PostToolUse on Bash
 * Profile:  standard,strict
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ensureDir, getTempDir } = require('../lib/utils');

const FIX_PATTERN = /^(fix|hotfix|bugfix)(\([^)]*\))?:/i;
const GH_MERGE_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Command parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract commit message from a git commit command string.
 * Handles: -m "msg", -m 'msg', --message "msg"
 */
function extractCommitMessage(cmd) {
  const patterns = [
    /(?:-m|--message)\s+"((?:[^"\\]|\\.)*)"/,
    /(?:-m|--message)\s+'((?:[^'\\]|\\.)*)'/,
    /(?:-m|--message)\s+(\S+)/,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extract PR title from a gh pr create command.
 * Handles: --title "msg", -t "msg"
 */
function extractPrTitle(cmd) {
  const patterns = [
    /(?:--title|-t)\s+"((?:[^"\\]|\\.)*)"/,
    /(?:--title|-t)\s+'((?:[^'\\]|\\.)*)'/,
  ];
  for (const re of patterns) {
    const m = cmd.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extract combined stdout/stderr text from a PostToolUse Bash tool_response.
 * Real shape: { stdout, stderr, interrupted, isImage }. Also tolerates a
 * plain string or a legacy { output } shape as harmless fallbacks.
 */
function extractOutputText(toolResponse) {
  if (!toolResponse) return '';
  if (typeof toolResponse === 'string') return toolResponse;
  if (typeof toolResponse === 'object') {
    return [toolResponse.stdout, toolResponse.stderr, toolResponse.output]
      .filter(part => typeof part === 'string' && part)
      .join('\n');
  }
  return '';
}

/**
 * Parse gh's own merge-success message for the PR number and title, e.g.:
 *   "✓ Merged pull request #42 (fix: correct race condition)"
 *   "✓ Squashed and merged pull request #7 (fix(gap): add missing check)"
 *   "✓ Rebased and merged pull request owner/repo#9 (fix: ...)"
 * Returns { number, title } (title may be null if gh didn't include it).
 */
function extractMergedPrInfo(outputText) {
  if (!outputText) return null;
  // Title matching is greedy up to the last ')' on the line, since fix-type
  // titles can themselves contain parens (e.g. "fix(gap): ...") that would
  // otherwise truncate a naive non-greedy [^)]* capture.
  const m = outputText.match(
    /(?:Merged|Squashed and merged|Rebased and merged)\s+pull request\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)(?:\s*\(([^\n]*)\))?/i
  );
  if (!m) return null;
  return { number: m[1], title: m[2] ? m[2].trim() : null };
}

// Flags that consume the following token as a value (so it isn't mistaken
// for the PR reference positional argument).
const MERGE_REF_VALUE_FLAGS = new Set(['--repo', '-R', '--subject', '--body', '-b', '--body-file', '-F', '--match-head-commit']);

/**
 * Extract the PR reference (number, URL, or branch name) positional argument
 * from a `gh pr merge` command, skipping flags in any order/position.
 */
function extractMergeRef(cmd) {
  const tokens = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const mergeIdx = tokens.findIndex((t, i) => t === 'merge' && tokens[i - 1] === 'pr');
  if (mergeIdx === -1) return null;

  for (let i = mergeIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (MERGE_REF_VALUE_FLAGS.has(tok)) {
      i++; // skip the flag's value token
      continue;
    }
    if (tok.startsWith('-')) continue;
    return tok.replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * Fallback source: the local HEAD commit subject. Only meaningful when the
 * merge happened against the current checkout — silently returns null
 * (non-git cwd, no commits, git unavailable) otherwise.
 */
function getLastCommitSubject(cwd) {
  try {
    const result = spawnSync('git', ['log', '-1', '--format=%s'], {
      cwd,
      encoding: 'utf8',
      timeout: GH_MERGE_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    const subject = (result.stdout || '').trim();
    return subject || null;
  } catch {
    return null;
  }
}

/**
 * Last-resort source: ask gh for the PR's title directly. Bounded to a
 * short timeout; any failure (no gh, network, bad ref, timeout) is silent.
 */
function getPrTitleViaGh(ref, cwd) {
  if (!ref) return null;
  try {
    const result = spawnSync('gh', ['pr', 'view', ref, '--json', 'title'], {
      cwd,
      encoding: 'utf8',
      timeout: GH_MERGE_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    const parsed = JSON.parse(result.stdout || '{}');
    return typeof parsed.title === 'string' && parsed.title ? parsed.title : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the title of a merged PR from a `gh pr merge` command, trying
 * each source in order until one yields a non-empty title.
 */
function resolveMergedPrTitle(cmd, toolResponse, cwd) {
  const merged = extractMergedPrInfo(extractOutputText(toolResponse));
  if (merged && merged.title) return merged.title;

  const localSubject = getLastCommitSubject(cwd);
  if (localSubject) return localSubject;

  const ref = (merged && merged.number) || extractMergeRef(cmd);
  return getPrTitleViaGh(ref, cwd);
}

/**
 * Determine whether the command is a triggerable fix operation.
 * Returns { triggered: true, type, subject } or { triggered: false }.
 */
function analyzeCommand(cmd, context = {}) {
  // git commit
  if (/\bgit\s+commit\b/.test(cmd)) {
    const msg = extractCommitMessage(cmd);
    if (msg && FIX_PATTERN.test(msg.trim())) {
      return { triggered: true, type: 'commit', subject: msg };
    }
    return { triggered: false };
  }

  // gh pr create
  if (/\bgh\s+pr\s+create\b/.test(cmd)) {
    const title = extractPrTitle(cmd);
    if (title && FIX_PATTERN.test(title.trim())) {
      return { triggered: true, type: 'pr-create', subject: title };
    }
    return { triggered: false };
  }

  // gh pr merge — resolve the merged PR's title from output, local git log,
  // or gh itself, then test it against the same fix-prefix patterns.
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) {
    let title = null;
    try {
      title = resolveMergedPrTitle(cmd, context.toolResponse, context.cwd || process.cwd());
    } catch {
      // Never let title resolution throw or block this hook.
      title = null;
    }
    if (title && FIX_PATTERN.test(title.trim())) {
      return { triggered: true, type: 'pr-merge', subject: title.trim() };
    }
    return { triggered: false };
  }

  return { triggered: false };
}

// ---------------------------------------------------------------------------
// Bundle helpers
// ---------------------------------------------------------------------------

function getRcaStoreCandidates(options = {}) {
  if (Array.isArray(options.candidateDirs) && options.candidateDirs.length > 0) {
    return Array.from(new Set(options.candidateDirs.filter(Boolean)));
  }

  const configuredDir = options.bundleDir
    || process.env.CLAUDE_RCA_BUNDLE_DIR
    || null;
  const homeDir = process.env.HOME || os.homedir();
  const canonicalDir = path.join(homeDir, '.claude', 'rca', 'bundles');
  const fallbackTempDir = path.join(getTempDir(), 'ecc-rca-bundles');

  return Array.from(new Set([
    configuredDir,
    canonicalDir,
    fallbackTempDir,
  ].filter(Boolean)));
}

function classifyStore(dirPath, options = {}) {
  const configuredDir = options.bundleDir
    || process.env.CLAUDE_RCA_BUNDLE_DIR
    || null;
  const canonicalDir = path.join(process.env.HOME || os.homedir(), '.claude', 'rca', 'bundles');
  if (configuredDir && path.resolve(dirPath) === path.resolve(configuredDir)) {
    return 'persistent';
  }

  return path.resolve(dirPath) === path.resolve(canonicalDir)
    ? 'persistent'
    : 'fallback';
}

function writeBundleToStore(bundle, options = {}) {
  const hash = crypto.createHash('sha1')
    .update(bundle.commitRef + bundle.generatedAt)
    .digest('hex')
    .slice(0, 8);

  const errors = [];
  for (const dirPath of getRcaStoreCandidates(options)) {
    try {
      ensureDir(dirPath);
      const bundlePath = path.join(dirPath, `rca-bundle-${hash}.json`);
      fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
      return {
        bundlePath,
        storageMode: classifyStore(dirPath, options),
      };
    } catch (error) {
      errors.push(`${dirPath}: ${error.message}`);
    }
  }

  throw new Error(`Failed to write bundle to any RCA store: ${errors.join(' | ')}`);
}

// ---------------------------------------------------------------------------
// hookSpecificOutput builder
// ---------------------------------------------------------------------------

function buildHookOutput(bundle, bundlePath, subject, triggerType, storageMode) {
  const domains = bundle.affectedDomains.map(d => d.domainKey).join(', ') || '(unknown)';
  const files = bundle.changedFiles.slice(0, 8).join('\n  ') || '(none)';

  const triggerLabel = triggerType === 'pr-create'
    ? 'PR 생성'
    : triggerType === 'pr-merge'
      ? 'PR 병합'
      : '커밋';

  const message = [
    `## RCA 분석 필요 — ${triggerLabel} 감지됨`,
    ``,
    `**커밋/PR**: \`${subject}\``,
    `**변경 파일** (${bundle.changedFiles.length}개):`,
    `  ${files}`,
    `**영향 도메인**: ${domains}`,
    `**저장소**: ${storageMode === 'persistent' ? 'shared RCA store' : 'fallback temp store'}`,
    ``,
    `### 다음 단계`,
    ``,
    `아래 컨텍스트 번들을 사용해 **분리된 Agent**로 RCA를 실행하세요:`,
    ``,
    `\`\`\``,
    `번들 경로: ${bundlePath}`,
    `\`\`\``,
    ``,
    `**Agent 호출 시 전달할 내용:**`,
    `1. 번들 파일 읽기 (\`${bundlePath}\`)`,
    `2. \`/commit-rca\` 스킬 지침 따르기`,
    `3. 근본 원인 분석 후 관련 \`domain_*.json\`의 \`constraints[]\` 업데이트`,
    `4. 새 훅이 필요하면 제안서를 \`docs/rca/\` 에 작성`,
    ``,
    `> 이 분석은 메인 세션과 독립된 Agent(isolation: worktree)에서 실행해야 합니다.`,
  ].join('\n');

  return JSON.stringify({ hookSpecificOutput: { additionalContext: message } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(rawInput) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    process.stdout.write(rawInput);
    return;
  }

  if ((input.tool_name || '') !== 'Bash') {
    process.stdout.write(rawInput);
    return;
  }

  const cmd = String(input.tool_input?.command || '');
  const analysis = analyzeCommand(cmd, { toolResponse: input.tool_response, cwd: process.cwd() });

  if (!analysis.triggered) {
    process.stdout.write(rawInput);
    return;
  }

  // Lazy-load builder to avoid startup cost when not triggered
  let buildRcaBundle;
  try {
    ({ buildRcaBundle } = require('../lib/rca-context-builder'));
  } catch (e) {
    process.stderr.write(`[commit-rca] Failed to load rca-context-builder: ${e.message}\n`);
    process.stdout.write(rawInput);
    return;
  }

  let bundle;
  try {
    bundle = buildRcaBundle({ commitRef: 'HEAD', projectRoot: process.cwd() });
  } catch (e) {
    process.stderr.write(`[commit-rca] Bundle build failed: ${e.message}\n`);
    process.stdout.write(rawInput);
    return;
  }

  let bundleInfo;
  try {
    bundleInfo = writeBundleToStore(bundle);
  } catch (e) {
    process.stderr.write(`[commit-rca] Failed to write bundle: ${e.message}\n`);
    process.stdout.write(rawInput);
    return;
  }

  if (bundleInfo.storageMode !== 'persistent') {
    process.stderr.write(`[commit-rca] Warning: using fallback RCA store at ${bundleInfo.bundlePath}\n`);
  }

  process.stderr.write(`[commit-rca] RCA triggered for "${analysis.subject}". Bundle: ${bundleInfo.bundlePath}\n`);
  process.stdout.write(buildHookOutput(bundle, bundleInfo.bundlePath, analysis.subject, analysis.type, bundleInfo.storageMode));
}

module.exports = { run, writeBundleToStore, getRcaStoreCandidates };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    run(Buffer.concat(chunks).toString('utf8'));
    process.exit(0);
  });
}
