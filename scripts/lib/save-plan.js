'use strict';

/**
 * Save a plan to ~/.claude/plans/<slug>-<timestamp>.md
 * Used by /plan command after user confirmation.
 *
 * Usage (from command):
 *   node scripts/lib/save-plan.js "<feature-name>" < plan-content.md
 *   node scripts/lib/save-plan.js "<feature-name>" --content "<inline content>"
 *
 * Returns: absolute path to the saved file (stdout)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Slugify a feature name for use in filenames.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return (name || 'plan')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'plan';
}

/**
 * Generate a timestamp string: YYYYMMDD-HHmm
 * @param {Date} [date]
 * @returns {string}
 */
function timestamp(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

/**
 * Save plan content to ~/.claude/plans/.
 *
 * @param {object} opts
 * @param {string} opts.content  - Markdown plan content
 * @param {string} [opts.name]   - Feature name used for filename slug
 * @param {Date}   [opts.date]   - Override date (useful in tests)
 * @returns {string} Absolute path of the saved file
 */
function savePlan({ content, name, date }) {
  if (!content || !content.trim()) {
    throw new Error('Plan content must not be empty');
  }

  const plansDir = path.join(os.homedir(), '.claude', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });

  const filename = `${slugify(name)}-${timestamp(date)}.md`;
  const filePath = path.join(plansDir, filename);

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

module.exports = { savePlan, slugify, timestamp };

// ── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const nameArg = args[0] && !args[0].startsWith('--') ? args[0] : undefined;

  // --content flag for inline content (avoids stdin piping in hooks)
  const contentFlagIdx = args.indexOf('--content');
  let content;

  if (contentFlagIdx !== -1 && args[contentFlagIdx + 1]) {
    content = args[contentFlagIdx + 1];
  } else {
    // Read from stdin
    try {
      // Cross-platform stdin read (works on Windows as well).
      // Node allows reading from fd 0 directly.
      content = fs.readFileSync(0, 'utf8');
    } catch {
      process.stderr.write('[save-plan] Error: no content provided via stdin or --content\n');
      process.exit(1);
    }
  }

  try {
    const filePath = savePlan({ content, name: nameArg });
    process.stdout.write(filePath + '\n');
  } catch (err) {
    process.stderr.write(`[save-plan] Error: ${err.message}\n`);
    process.exit(1);
  }
}
