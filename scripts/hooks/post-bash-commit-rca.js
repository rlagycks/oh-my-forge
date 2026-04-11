#!/usr/bin/env node
/**
 * PostToolUse Hook: Commit RCA Trigger
 *
 * Fires after a Bash tool call. When a git commit or gh pr command is detected
 * with a "fix-type" prefix (fix:, fix(gap):, fix(design):, hotfix:), this hook:
 *
 *   1. Builds a context bundle (git diff, decisions, affected ontology domains)
 *   2. Writes the bundle to ~/.claude/tmp/rca-bundle-<hash>.json
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
 * Trigger:  PostToolUse on Bash
 * Profile:  standard,strict
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const FIX_PATTERN = /^(fix|hotfix|bugfix)(\([^)]*\))?:/i;

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
 * Determine whether the command is a triggerable fix operation.
 * Returns { triggered: true, type, subject } or { triggered: false }.
 */
function analyzeCommand(cmd) {
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

  // gh pr merge — check output for PR title (title is in the tool response)
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) {
    // We'll check tool response output for the commit summary
    return { triggered: false, checkOutput: true };
  }

  return { triggered: false };
}

// ---------------------------------------------------------------------------
// Bundle helpers
// ---------------------------------------------------------------------------

function writeBundleToTmp(bundle) {
  const tmpDir = path.join(os.homedir(), '.claude', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const hash = crypto.createHash('sha1')
    .update(bundle.commitRef + bundle.generatedAt)
    .digest('hex')
    .slice(0, 8);
  const bundlePath = path.join(tmpDir, `rca-bundle-${hash}.json`);
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');
  return bundlePath;
}

// ---------------------------------------------------------------------------
// hookSpecificOutput builder
// ---------------------------------------------------------------------------

function buildHookOutput(bundle, bundlePath, subject, triggerType) {
  const domains = bundle.affectedDomains.map(d => d.domainKey).join(', ') || '(unknown)';
  const files = bundle.changedFiles.slice(0, 8).join('\n  ') || '(none)';

  const message = [
    `## RCA 분석 필요 — ${triggerType === 'pr-create' ? 'PR 생성' : '커밋'} 감지됨`,
    ``,
    `**커밋/PR**: \`${subject}\``,
    `**변경 파일** (${bundle.changedFiles.length}개):`,
    `  ${files}`,
    `**영향 도메인**: ${domains}`,
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
  const analysis = analyzeCommand(cmd);

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

  let bundlePath;
  try {
    bundlePath = writeBundleToTmp(bundle);
  } catch (e) {
    process.stderr.write(`[commit-rca] Failed to write bundle: ${e.message}\n`);
    process.stdout.write(rawInput);
    return;
  }

  process.stderr.write(`[commit-rca] RCA triggered for "${analysis.subject}". Bundle: ${bundlePath}\n`);
  process.stdout.write(buildHookOutput(bundle, bundlePath, analysis.subject, analysis.type));
}

module.exports = { run };

if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', () => {
    run(Buffer.concat(chunks).toString('utf8'));
    process.exit(0);
  });
}
