#!/usr/bin/env node
/**
 * Stop Hook (Session End) - Persist learnings during active sessions
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs on Stop events (after each response). Extracts a meaningful summary
 * from the session transcript (via stdin JSON transcript_path) and updates a
 * session file for cross-session continuity.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  getSessionsDir,
  getDateString,
  getTimeString,
  getSessionIdShort,
  getProjectName,
  ensureDir,
  readFile,
  writeFile,
  runCommand,
  stripAnsi,
  log
} = require('../lib/utils');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';
const SESSION_SEPARATOR = '\n---\n';

/**
 * Extract a meaningful summary from the session transcript.
 * Reads the JSONL transcript and pulls out key information:
 * - User messages (tasks requested)
 * - Tools used
 * - Files modified
 */
function extractSessionSummary(transcriptPath) {
  const content = readFile(transcriptPath);
  if (!content) return null;

  const lines = content.split('\n').filter(Boolean);
  const userMessages = [];
  const toolsUsed = new Set();
  const filesModified = new Set();
  const failureTrace = {
    failedHypotheses: [],
    falseNormalSignals: [],
    evidenceMissing: [],
    nextSuspicion: ''
  };
  let parseErrors = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      collectFailureTrace(entry, failureTrace);

      // Collect user messages (first 200 chars each)
      if (entry.type === 'user' || entry.role === 'user' || entry.message?.role === 'user') {
        // Support both direct content and nested message.content (Claude Code JSONL format)
        const rawContent = entry.message?.content ?? entry.content;
        const text = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.map(c => (c && c.text) || '').join(' ')
            : '';
        const cleaned = stripAnsi(text).trim();
        if (cleaned) {
          userMessages.push(cleaned.slice(0, 200));
        }
      }

      // Collect tool names and modified files (direct tool_use entries)
      if (entry.type === 'tool_use' || entry.tool_name) {
        const toolName = entry.tool_name || entry.name || '';
        if (toolName) toolsUsed.add(toolName);

        const filePath = entry.tool_input?.file_path || entry.input?.file_path || '';
        if (filePath && (toolName === 'Edit' || toolName === 'Write')) {
          filesModified.add(filePath);
        }
      }

      // Extract tool uses from assistant message content blocks (Claude Code JSONL format)
      if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name || '';
            if (toolName) toolsUsed.add(toolName);

            const filePath = block.input?.file_path || '';
            if (filePath && (toolName === 'Edit' || toolName === 'Write')) {
              filesModified.add(filePath);
            }
          }
        }
      }
    } catch {
      parseErrors++;
    }
  }

  if (parseErrors > 0) {
    log(`[SessionEnd] Skipped ${parseErrors}/${lines.length} unparseable transcript lines`);
  }

  if (userMessages.length === 0) return null;

  return {
    userMessages: userMessages.slice(-10), // Last 10 user messages
    toolsUsed: Array.from(toolsUsed).slice(0, 20),
    filesModified: Array.from(filesModified).slice(0, 30),
    failureTrace: normalizeFailureTrace(failureTrace),
    totalMessages: userMessages.length
  };
}

function extractTextValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      return item.text || item.content || item.output || '';
    }).join(' ');
  }
  if (value && typeof value === 'object') {
    return [
      value.text,
      value.content,
      value.output,
      value.stderr,
      value.stdout,
      value.error,
      value.message,
    ].filter(item => typeof item === 'string').join(' ');
  }
  return '';
}

function entryText(entry) {
  return [
    extractTextValue(entry.content),
    extractTextValue(entry.message?.content),
    extractTextValue(entry.tool_response),
    extractTextValue(entry.tool_result),
    extractTextValue(entry.result),
    extractTextValue(entry.output),
    extractTextValue(entry.stderr),
    extractTextValue(entry.error),
  ].filter(Boolean).join(' ');
}

function splitTraceSentences(text) {
  return stripAnsi(String(text || ''))
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|(?:\s+-\s+)/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function pushUnique(target, value, limit = 5) {
  const clean = String(value || '').trim();
  if (!clean || target.includes(clean) || target.length >= limit) return;
  target.push(clean);
}

function collectFailureTrace(entry, failureTrace) {
  const text = entryText(entry);
  if (!text) return;

  const nextSuspicionMatches = text.matchAll(/next suspicion\s*:\s*([^.\n]+)/ig);
  for (const match of nextSuspicionMatches) {
    failureTrace.nextSuspicion = match[1].trim();
  }

  for (const sentence of splitTraceSentences(text)) {
    const lower = sentence.toLowerCase();
    if (/\b(failed because|command failed|error:|blocked because|threw|crash(?:ed)?|timed out)\b/.test(lower)) {
      pushUnique(failureTrace.failedHypotheses, sentence);
    }
    if (/\b(false[- ]normal|looked healthy|tests? passed but|green but|summary claimed|healthy but)\b/.test(lower)) {
      pushUnique(failureTrace.falseNormalSignals, sentence);
    }
    if (/\b(evidence missing|missing evidence|without evidence|not verified|untested|skipped verification)\b/.test(lower)) {
      pushUnique(failureTrace.evidenceMissing, sentence);
    }
  }
}

function normalizeFailureTrace(failureTrace) {
  return {
    failedHypotheses: failureTrace.failedHypotheses.slice(0, 5),
    falseNormalSignals: failureTrace.falseNormalSignals.slice(0, 5),
    evidenceMissing: failureTrace.evidenceMissing.slice(0, 5),
    nextSuspicion: failureTrace.nextSuspicion || ''
  };
}

function hasConcreteFailureTrace(summary) {
  const trace = summary?.failureTrace || {};
  return Boolean(
    trace.nextSuspicion
    || (Array.isArray(trace.failedHypotheses) && trace.failedHypotheses.length > 0)
    || (Array.isArray(trace.falseNormalSignals) && trace.falseNormalSignals.length > 0)
    || (Array.isArray(trace.evidenceMissing) && trace.evidenceMissing.length > 0)
  );
}

function hashFailureTrace(trace) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(trace || {}))
    .digest('hex')
    .slice(0, 12);
}

function buildFailureTracePromotion(summary, sessionFile) {
  const trace = summary.failureTrace;
  const nextSuspicion = trace.nextSuspicion || 'unresolved failure trace';
  const failedHypotheses = Array.isArray(trace.failedHypotheses) ? trace.failedHypotheses : [];
  const falseNormalSignals = Array.isArray(trace.falseNormalSignals) ? trace.falseNormalSignals : [];
  const evidenceMissing = Array.isArray(trace.evidenceMissing) ? trace.evidenceMissing : [];
  const whyParts = [
    ...failedHypotheses,
    ...falseNormalSignals.map(signal => `False-normal signal: ${signal}`),
    ...evidenceMissing.map(signal => `Evidence missing: ${signal}`),
  ];

  return {
    domain: 'domain_session',
    type: 'failure-trace',
    summary: `Failure trace: ${nextSuspicion}`.slice(0, 200),
    why: whyParts.join(' | ') || 'SessionEnd captured an unresolved failure trace for future debugging.',
    files: Array.isArray(summary.filesModified) ? summary.filesModified : [],
    ref: `failure-trace:${path.basename(sessionFile)}:${hashFailureTrace(trace)}`,
    evidence: [],
    falseNormalSignals,
    verifyWith: evidenceMissing.map(signal => `Resolve missing evidence: ${signal}`),
    nextSuspicion,
    writeDomain: false,
    dedupeRef: true,
  };
}

function promoteFailureTrace(summary, sessionFile) {
  if (!hasConcreteFailureTrace(summary)) return;

  try {
    const { addDecision } = require('../lib/decisions');
    const entry = addDecision(buildFailureTracePromotion(summary, sessionFile));
    log(`[SessionEnd] Promoted failure trace to durable decisions log: ${entry.id}`);
  } catch (err) {
    log(`[SessionEnd] Failed to promote failure trace: ${err.message}`);
  }
}

// Read hook input from stdin (Claude Code provides transcript_path via stdin JSON)
const MAX_STDIN = 1024 * 1024;
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    const remaining = MAX_STDIN - stdinData.length;
    stdinData += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  runMain();
});

function runMain() {
  main().catch(err => {
    console.error('[SessionEnd] Error:', err.message);
    process.exit(0);
  });
}

function getSessionMetadata() {
  const branchResult = runCommand('git rev-parse --abbrev-ref HEAD');

  return {
    project: getProjectName() || 'unknown',
    branch: branchResult.success ? branchResult.output : 'unknown',
    worktree: process.cwd()
  };
}

function extractHeaderField(header, label) {
  const match = header.match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function buildSessionHeader(today, currentTime, metadata, existingContent = '') {
  const headingMatch = existingContent.match(/^#\s+.+$/m);
  const heading = headingMatch ? headingMatch[0] : `# Session: ${today}`;
  const date = extractHeaderField(existingContent, 'Date') || today;
  const started = extractHeaderField(existingContent, 'Started') || currentTime;

  return [
    heading,
    `**Date:** ${date}`,
    `**Started:** ${started}`,
    `**Last Updated:** ${currentTime}`,
    `**Project:** ${metadata.project}`,
    `**Branch:** ${metadata.branch}`,
    `**Worktree:** ${metadata.worktree}`,
    ''
  ].join('\n');
}

function mergeSessionHeader(content, today, currentTime, metadata) {
  const separatorIndex = content.indexOf(SESSION_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const existingHeader = content.slice(0, separatorIndex);
  const body = content.slice(separatorIndex + SESSION_SEPARATOR.length);
  const nextHeader = buildSessionHeader(today, currentTime, metadata, existingHeader);
  return `${nextHeader}${SESSION_SEPARATOR}${body}`;
}

async function main() {
  // Parse stdin JSON to get transcript_path
  let transcriptPath = null;
  try {
    const input = JSON.parse(stdinData);
    transcriptPath = input.transcript_path;
  } catch {
    // Fallback: try env var for backwards compatibility
    transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;
  }

  const sessionsDir = getSessionsDir();
  const today = getDateString();
  const shortId = getSessionIdShort();
  const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
  const sessionMetadata = getSessionMetadata();

  ensureDir(sessionsDir);

  const currentTime = getTimeString();

  // Try to extract summary from transcript
  let summary = null;

  if (transcriptPath) {
    if (fs.existsSync(transcriptPath)) {
      summary = extractSessionSummary(transcriptPath);
    } else {
      log(`[SessionEnd] Transcript not found: ${transcriptPath}`);
    }
  }

  if (fs.existsSync(sessionFile)) {
    const existing = readFile(sessionFile);
    let updatedContent = existing;

    if (existing) {
      const merged = mergeSessionHeader(existing, today, currentTime, sessionMetadata);
      if (merged) {
        updatedContent = merged;
      } else {
        log(`[SessionEnd] Failed to normalize header in ${sessionFile}`);
      }
    }

    // If we have a new summary, update only the generated summary block.
    // This keeps repeated Stop invocations idempotent and preserves
    // user-authored sections in the same session file.
    if (summary && updatedContent) {
      const summaryBlock = buildSummaryBlock(summary);

      if (updatedContent.includes(SUMMARY_START_MARKER) && updatedContent.includes(SUMMARY_END_MARKER)) {
        updatedContent = updatedContent.replace(
          new RegExp(`${escapeRegExp(SUMMARY_START_MARKER)}[\\s\\S]*?${escapeRegExp(SUMMARY_END_MARKER)}`),
          summaryBlock
        );
      } else {
        // Migration path for files created before summary markers existed.
        updatedContent = updatedContent.replace(
          /## (?:Session Summary|Current State)[\s\S]*?$/,
          `${summaryBlock}\n\n${buildFollowUpTemplate(summary)}\n`
        );
      }
    }

    if (updatedContent) {
      writeFile(sessionFile, updatedContent);
    }

    log(`[SessionEnd] Updated session file: ${sessionFile}`);
  } else {
    // Create new session file
    const summarySection = summary
      ? `${buildSummaryBlock(summary)}\n\n${buildFollowUpTemplate(summary)}`
      : `## Current State\n\n[Session context goes here]\n\n### Completed\n- [ ]\n\n### In Progress\n- [ ]\n\n${buildFollowUpTemplate()}`;

    const template = `${buildSessionHeader(today, currentTime, sessionMetadata)}${SESSION_SEPARATOR}${summarySection}
`;

    writeFile(sessionFile, template);
    log(`[SessionEnd] Created session file: ${sessionFile}`);
  }

  promoteFailureTrace(summary, sessionFile);

  process.exit(0);
}

function buildSummarySection(summary) {
  let section = '## Session Summary\n\n';

  // Tasks (from user messages — collapse newlines and escape backticks to prevent markdown breaks)
  section += '### Tasks\n';
  for (const msg of summary.userMessages) {
    section += `- ${msg.replace(/\n/g, ' ').replace(/`/g, '\\`')}\n`;
  }
  section += '\n';

  // Files modified
  if (summary.filesModified.length > 0) {
    section += '### Files Modified\n';
    for (const f of summary.filesModified) {
      section += `- ${f}\n`;
    }
    section += '\n';
  }

  // Tools used
  if (summary.toolsUsed.length > 0) {
    section += `### Tools Used\n${summary.toolsUsed.join(', ')}\n\n`;
  }

  section += `### Stats\n- Total user messages: ${summary.totalMessages}\n`;

  return section;
}

function buildSummaryBlock(summary) {
  return `${SUMMARY_START_MARKER}\n${buildSummarySection(summary).trim()}\n${SUMMARY_END_MARKER}`;
}

function markdownItem(value) {
  return String(value || '').replace(/\n/g, ' ').replace(/`/g, '\\`');
}

function traceItems(items, fallback) {
  const values = Array.isArray(items) && items.length > 0 ? items : [fallback];
  return values.map(item => `  - ${markdownItem(item)}`);
}

function buildFollowUpTemplate(summary = null) {
  const trace = summary?.failureTrace || {};
  return [
    '### Failure Trace',
    'Failure Trace Ledger — record misleading signals before writing generic lessons.',
    '- Failed hypotheses:',
    ...traceItems(trace.failedHypotheses, '[approach tried] -> [exact failure reason or error]'),
    '- False-normal signals:',
    ...traceItems(trace.falseNormalSignals, '[signal that looked healthy] -> [what it hid]'),
    '- Evidence still missing:',
    ...traceItems(trace.evidenceMissing, '[claim] -> [proof still needed]'),
    '',
    '### Next Suspicion',
    `- Next suspicion: ${markdownItem(trace.nextSuspicion || '[first place to inspect if this recurs]')}`,
    '',
    '### Next Action',
    '- [single concrete next operator action]',
    '',
    '### Context to Load',
    '```',
    '[relevant files]',
    '```',
  ].join('\n');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
