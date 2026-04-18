#!/usr/bin/env node
/**
 * SessionStart Hook - Load previous context on new session
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs when a new Claude session starts. Loads the most recent session
 * summary into Claude's context via stdout, and reports available
 * sessions and learned skills.
 */

const {
  getSessionsDir,
  getSessionSearchDirs,
  getLearnedSkillsDir,
  getProjectName,
  findFiles,
  ensureDir,
  readFile,
  stripAnsi,
  log
} = require('../lib/utils');
const { getPackageManager, getSelectionPrompt } = require('../lib/package-manager');
const { listAliases } = require('../lib/session-aliases');
const { detectProjectType } = require('../lib/project-detect');
const path = require('path');
const fs = require('fs');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';
const SESSION_METADATA_LABELS = ['Project', 'Branch', 'Worktree'];
const SESSION_METADATA_PATTERN = /^\*\*(Project|Branch|Worktree):\*\*\s*(.+)$/gm;

/**
 * Resolve a filesystem path to its canonical (real) form.
 *
 * Handles symlinks and, on case-insensitive filesystems (macOS, Windows),
 * normalizes casing so that path comparisons are reliable.
 * Falls back to the original path if resolution fails (e.g. path no longer exists).
 *
 * @param {string} p - The path to normalize.
 * @returns {string} The canonical path, or the original if resolution fails.
 */
function normalizePath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function dedupeRecentSessions(searchDirs) {
  const recentSessionsByName = new Map();

  for (const [dirIndex, dir] of searchDirs.entries()) {
    const matches = findFiles(dir, '*-session.tmp', { maxAge: 7 });

    for (const match of matches) {
      const basename = path.basename(match.path);
      const current = {
        ...match,
        basename,
        dirIndex,
      };
      const existing = recentSessionsByName.get(basename);

      if (
        !existing
        || current.mtime > existing.mtime
        || (current.mtime === existing.mtime && current.dirIndex < existing.dirIndex)
      ) {
        recentSessionsByName.set(basename, current);
      }
    }
  }

  return Array.from(recentSessionsByName.values())
    .sort((left, right) => right.mtime - left.mtime || left.dirIndex - right.dirIndex);
}

/**
 * Select the best matching session for the current working directory.
 *
 * Session files written by session-end.js contain header fields like:
 *   **Project:** my-project
 *   **Worktree:** /path/to/project
 *
 * This function reads each session file once, caching its content, and
 * returns both the selected session object and its already-read content
 * to avoid duplicate I/O in the caller.
 *
 * Priority (highest to lowest):
 *   1. Exact worktree (cwd) match — most recent
 *   2. Same project name match — most recent
 *   3. Fallback to overall most recent (original behavior)
 *
 * Sessions are already sorted newest-first, so the first match in each
 * category wins.
 *
 * @param {Array<Object>} sessions - Deduplicated session list, sorted newest-first.
 * @param {string} cwd - Current working directory (process.cwd()).
 * @param {string} currentProject - Current project name from getProjectName().
 * @returns {{ session: Object, content: string, matchReason: string } | null}
 *   The best matching session with its cached content and match reason,
 *   or null if the sessions array is empty or all files are unreadable.
 */
function selectMatchingSession(sessions, cwd, currentProject) {
  if (sessions.length === 0) return null;

  // Normalize cwd once outside the loop to avoid repeated syscalls
  const normalizedCwd = normalizePath(cwd);

  let projectMatch = null;
  let projectMatchContent = null;
  let fallbackSession = null;
  let fallbackContent = null;

  for (const session of sessions) {
    const content = readFile(session.path);
    if (!content) continue;

    // Cache first readable session+content pair for fallback
    if (!fallbackSession) {
      fallbackSession = session;
      fallbackContent = content;
    }

    // Extract **Worktree:** field
    const worktreeMatch = content.match(/\*\*Worktree:\*\*\s*(.+)$/m);
    const sessionWorktree = worktreeMatch ? worktreeMatch[1].trim() : '';

    // Exact worktree match — best possible, return immediately
    // Normalize both paths to handle symlinks and case-insensitive filesystems
    if (sessionWorktree && normalizePath(sessionWorktree) === normalizedCwd) {
      return { session, content, matchReason: 'worktree' };
    }

    // Project name match — keep searching for a worktree match
    if (!projectMatch && currentProject) {
      const projectFieldMatch = content.match(/\*\*Project:\*\*\s*(.+)$/m);
      const sessionProject = projectFieldMatch ? projectFieldMatch[1].trim() : '';
      if (sessionProject && sessionProject === currentProject) {
        projectMatch = session;
        projectMatchContent = content;
      }
    }
  }

  if (projectMatch) {
    return { session: projectMatch, content: projectMatchContent, matchReason: 'project' };
  }

  // Fallback: most recent readable session (original behavior)
  if (fallbackSession) {
    return { session: fallbackSession, content: fallbackContent, matchReason: 'recency-fallback' };
  }

  log('[SessionStart] All session files were unreadable');
  return null;
}

function normalizeHeading(value) {
  return String(value || '')
    .replace(/[`*_]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseHeading(line) {
  const match = String(line || '').match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;
  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

function extractMarkdownSection(lines, heading) {
  const sourceLines = Array.isArray(lines) ? lines : String(lines || '').split('\n');
  const target = normalizeHeading(heading);
  let startIndex = -1;
  let startLevel = 0;

  for (let index = 0; index < sourceLines.length; index++) {
    const parsed = parseHeading(sourceLines[index]);
    if (parsed && normalizeHeading(parsed.text) === target) {
      startIndex = index;
      startLevel = parsed.level;
      break;
    }
  }

  if (startIndex === -1) return '';

  let endIndex = sourceLines.length;
  for (let index = startIndex + 1; index < sourceLines.length; index++) {
    const parsed = parseHeading(sourceLines[index]);
    if (parsed && parsed.level <= startLevel) {
      endIndex = index;
      break;
    }
  }

  return sourceLines.slice(startIndex, endIndex).join('\n').trim();
}

function extractSessionMetadata(content) {
  const metadataByLabel = new Map();
  for (const match of String(content || '').matchAll(SESSION_METADATA_PATTERN)) {
    if (match[2].trim()) {
      metadataByLabel.set(match[1], match[2].trim());
    }
  }
  return SESSION_METADATA_LABELS
    .filter(label => metadataByLabel.has(label))
    .map(label => `**${label}:** ${metadataByLabel.get(label)}`);
}

function hasGeneratedSummaryBlock(content) {
  return String(content || '').includes(SUMMARY_START_MARKER)
    && String(content || '').includes(SUMMARY_END_MARKER);
}

function buildSessionStartContext(content) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent || cleanContent.includes('[Session context goes here]')) {
    return '';
  }

  const contextHeadings = [
    'Tasks',
    'Files Modified',
    'What WORKED (with evidence)',
    'Failure Trace Ledger',
    'Failure Trace',
    'Evidence still missing',
    'Next Suspicion',
    'Next Action',
    'Context to Load',
  ];
  const lines = cleanContent.split('\n');
  const metadata = extractSessionMetadata(cleanContent);

  if (!hasGeneratedSummaryBlock(cleanContent)) {
    if (metadata.length > 0) {
      const hasResumeSection = contextHeadings.some(heading => extractMarkdownSection(lines, heading));
      if (!hasResumeSection) {
        return metadata.join('\n').trim();
      }
    }
    return cleanContent;
  }

  const sections = contextHeadings
    .map(heading => extractMarkdownSection(lines, heading))
    .filter(Boolean);

  if (sections.length === 0) {
    return metadata.join('\n').trim();
  }

  return [...metadata, ...sections].join('\n\n').trim();
}

async function main() {
  const sessionsDir = getSessionsDir();
  const learnedDir = getLearnedSkillsDir();
  const additionalContextParts = [];

  // Ensure directories exist
  ensureDir(sessionsDir);
  ensureDir(learnedDir);

  // Check for recent session files (last 7 days)
  const recentSessions = dedupeRecentSessions(getSessionSearchDirs());

  if (recentSessions.length > 0) {
    log(`[SessionStart] Found ${recentSessions.length} recent session(s)`);

    // Prefer a session that matches the current working directory or project.
    // Session files contain **Project:** and **Worktree:** header fields written
    // by session-end.js, so we can match against them.
    const cwd = process.cwd();
    const currentProject = getProjectName() || '';

    const result = selectMatchingSession(recentSessions, cwd, currentProject);

    if (result) {
      log(`[SessionStart] Selected: ${result.session.path} (match: ${result.matchReason})`);

      // Use the already-read content from selectMatchingSession (no duplicate I/O)
      const content = stripAnsi(result.content);
      const sessionContext = buildSessionStartContext(content);
      if (sessionContext) {
        additionalContextParts.push(`Previous session summary:\n${sessionContext}`);
      }
    } else {
      log('[SessionStart] No matching session found');
    }
  }

  // Check for learned skills
  const learnedSkills = findFiles(learnedDir, '*.md');

  if (learnedSkills.length > 0) {
    log(`[SessionStart] ${learnedSkills.length} learned skill(s) available in ${learnedDir}`);
  }

  // Check for available session aliases
  const aliases = listAliases({ limit: 5 });

  if (aliases.length > 0) {
    const aliasNames = aliases.map(a => a.name).join(', ');
    log(`[SessionStart] ${aliases.length} session alias(es) available: ${aliasNames}`);
    log(`[SessionStart] Use /sessions load <alias> to continue a previous session`);
  }

  // Detect and report package manager
  const pm = getPackageManager();
  log(`[SessionStart] Package manager: ${pm.name} (${pm.source})`);

  // If no explicit package manager config was found, show selection prompt
  if (pm.source === 'default') {
    log('[SessionStart] No package manager preference found.');
    log(getSelectionPrompt());
  }

  // Detect project type and frameworks (#293)
  const projectInfo = detectProjectType();
  if (projectInfo.languages.length > 0 || projectInfo.frameworks.length > 0) {
    const parts = [];
    if (projectInfo.languages.length > 0) {
      parts.push(`languages: ${projectInfo.languages.join(', ')}`);
    }
    if (projectInfo.frameworks.length > 0) {
      parts.push(`frameworks: ${projectInfo.frameworks.join(', ')}`);
    }
    log(`[SessionStart] Project detected — ${parts.join('; ')}`);
    additionalContextParts.push(`Project type: ${JSON.stringify(projectInfo)}`);
  } else {
    log('[SessionStart] No specific project type detected');
  }

  await writeSessionStartPayload(additionalContextParts.join('\n\n'));
}

function writeSessionStartPayload(additionalContext) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      }
    });

    const handleError = (err) => {
      if (settled) return;
      settled = true;
      if (err) {
        log(`[SessionStart] stdout write error: ${err.message}`);
      }
      reject(err || new Error('stdout stream error'));
    };

    process.stdout.once('error', handleError);
    process.stdout.write(payload, (err) => {
      process.stdout.removeListener('error', handleError);
      if (settled) return;
      settled = true;
      if (err) {
        log(`[SessionStart] stdout write error: ${err.message}`);
        reject(err);
        return;
      }
      resolve();
    });
  });
}

main().catch(err => {
  console.error('[SessionStart] Error:', err.message);
  process.exitCode = 0; // Don't block on errors
});
