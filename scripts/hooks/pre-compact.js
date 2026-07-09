#!/usr/bin/env node
/**
 * PreCompact Hook - Save state before context compaction
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs before Claude compacts context, giving you a chance to
 * preserve important state that might get lost in summarization.
 */

const path = require('path');
const {
  getSessionsDir,
  getDateTimeString,
  getTimeString,
  findFiles,
  ensureDir,
  appendFile,
  readFile,
  writeFile,
  log
} = require('../lib/utils');

// Matches both the legacy per-compaction marker line (with its leading
// separator) and the consolidated marker this hook now writes, so repeated
// compactions collapse into a single running-count line instead of
// accumulating unboundedly in the session file.
const LEGACY_MARKER_RE = /\n?---\n\*\*\[Compaction occurred at [^\]]+\]\*\* - Context was summarized\n?/g;
const CONSOLIDATED_MARKER_RE = /\n?---\n\*\*\[Compactions: (\d+), last at [^\]]+\]\*\* - Context was summarized\n?/g;

/**
 * Strip any existing compaction marker lines from session content and
 * return the cleaned content plus the total prior compaction count so a
 * single consolidated marker can be appended.
 */
function stripCompactionMarkers(content) {
  let priorCount = 0;

  const consolidatedMatches = content.match(CONSOLIDATED_MARKER_RE) || [];
  for (const match of consolidatedMatches) {
    const countMatch = match.match(/Compactions: (\d+)/);
    priorCount += countMatch ? parseInt(countMatch[1], 10) || 0 : 0;
  }
  content = content.replace(CONSOLIDATED_MARKER_RE, '');

  const legacyMatches = content.match(LEGACY_MARKER_RE) || [];
  priorCount += legacyMatches.length;
  content = content.replace(LEGACY_MARKER_RE, '');

  return { content, priorCount };
}

async function main() {
  const sessionsDir = getSessionsDir();
  const compactionLog = path.join(sessionsDir, 'compaction-log.txt');

  ensureDir(sessionsDir);

  // Log compaction event with timestamp
  const timestamp = getDateTimeString();
  appendFile(compactionLog, `[${timestamp}] Context compaction triggered\n`);

  // If there's an active session file, note the compaction. findFiles()
  // already sorts results newest-mtime-first, so [0] is the most recently
  // modified session file.
  const sessions = findFiles(sessionsDir, '*-session.tmp');

  if (sessions.length > 0) {
    const activeSession = sessions[0].path;
    const timeStr = getTimeString();
    const existing = readFile(activeSession) || '';
    const { content: cleaned, priorCount } = stripCompactionMarkers(existing);
    const nextCount = priorCount + 1;
    const marker = `\n---\n**[Compactions: ${nextCount}, last at ${timeStr}]** - Context was summarized\n`;
    writeFile(activeSession, `${cleaned}${marker}`);
  }

  log('[PreCompact] State saved before compaction');
  process.exit(0);
}

main().catch(err => {
  console.error('[PreCompact] Error:', err.message);
  process.exit(0);
});
