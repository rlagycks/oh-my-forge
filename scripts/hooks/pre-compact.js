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
const { buildContinuityPacket } = require('../lib/continuity-packet');

// Matches both the legacy per-compaction marker line (with its leading
// separator) and the consolidated marker this hook now writes, so repeated
// compactions collapse into a single running-count line instead of
// accumulating unboundedly in the session file.
const LEGACY_MARKER_RE = /\n?---\n\*\*\[Compaction occurred at [^\]]+\]\*\* - Context was summarized\n?/g;
const CONSOLIDATED_MARKER_RE = /\n?---\n\*\*\[Compactions: (\d+), last at [^\]]+\]\*\* - Context was summarized\n?/g;

// Delimits the embedded continuity packet section so it can be stripped and
// re-appended fresh on every compaction, instead of accumulating.
const CONTINUITY_PACKET_BEGIN = '<!-- CONTINUITY-PACKET:BEGIN -->';
const CONTINUITY_PACKET_END = '<!-- CONTINUITY-PACKET:END -->';
const CONTINUITY_PACKET_RE = /\n?<!-- CONTINUITY-PACKET:BEGIN -->[\s\S]*?<!-- CONTINUITY-PACKET:END -->\n?/g;

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

/**
 * Strip any previously embedded continuity packet section from session
 * content so a fresh packet replaces it rather than accumulating across
 * repeated compactions.
 */
function stripContinuityPacket(content) {
  return content.replace(CONTINUITY_PACKET_RE, '');
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
    const { content: markersStripped, priorCount } = stripCompactionMarkers(existing);
    const cleaned = stripContinuityPacket(markersStripped);
    const nextCount = priorCount + 1;
    const marker = `\n---\n**[Compactions: ${nextCount}, last at ${timeStr}]** - Context was summarized\n`;

    let updated = `${cleaned}${marker}`;

    const { text: packetText } = buildContinuityPacket({ cwd: process.cwd() });
    if (packetText) {
      updated += `\n${CONTINUITY_PACKET_BEGIN}\n${packetText}\n${CONTINUITY_PACKET_END}\n`;
    }

    writeFile(activeSession, updated);
  }

  log('[PreCompact] State saved before compaction');
  process.exit(0);
}

main().catch(err => {
  console.error('[PreCompact] Error:', err.message);
  process.exit(0);
});
