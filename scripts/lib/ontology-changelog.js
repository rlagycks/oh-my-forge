'use strict';

/**
 * Ontology Changelog helper.
 *
 * Maintains an append-only human-readable log at .claude/ontology/CHANGELOG.md.
 * Each entry records what changed, when, and why — modelled on Codesight's wiki log.md.
 *
 * Usage:
 *   const { appendEntry } = require('./ontology-changelog');
 *   appendEntry(projectRoot, {
 *     domain:        'domain_qa',
 *     action:        'added',           // 'added' | 'updated' | 'removed'
 *     changedFields: ['files', 'spec'],  // optional
 *     trigger:       'ontology-sync',   // free-form string
 *     reason:        'spec file found, no index entry',  // optional
 *   });
 */

const fs = require('fs');
const path = require('path');

const CHANGELOG_REL = '.claude/ontology/CHANGELOG.md';

const HEADER = `# Ontology Changelog

Append-only log of changes to \`.claude/ontology/index.json\`.
Newest entries appear first. Do not edit manually.

---

`;

/**
 * Format today's date as YYYY-MM-DD in local time.
 * @returns {string}
 */
function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build a single changelog entry block.
 * @param {object} opts
 * @param {string} opts.domain
 * @param {'added'|'updated'|'removed'} opts.action
 * @param {string[]} [opts.changedFields]
 * @param {string} [opts.trigger]
 * @param {string} [opts.reason]
 * @returns {string}
 */
function buildEntry({ domain, action, changedFields, trigger, reason }) {
  const lines = [`## ${today()} — ${domain} [${action}]`];
  if (changedFields && changedFields.length > 0) {
    lines.push(`**Fields**: ${changedFields.join(', ')}`);
  }
  if (trigger) {
    lines.push(`**Trigger**: ${trigger}`);
  }
  if (reason) {
    lines.push(`**Reason**: ${reason}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Append a new entry to the changelog file.
 * Creates the file (with header) if it does not exist.
 *
 * @param {string} projectRoot  Absolute path to the project root.
 * @param {object} opts         Entry options — see buildEntry.
 */
function appendEntry(projectRoot, opts) {
  const changelogPath = path.join(projectRoot, CHANGELOG_REL);
  const entry = buildEntry(opts) + '\n---\n\n';

  try {
    if (!fs.existsSync(changelogPath)) {
      fs.writeFileSync(changelogPath, HEADER + entry, 'utf8');
      return;
    }

    const current = fs.readFileSync(changelogPath, 'utf8');

    // Insert after the header (after the first '---\n\n' separator).
    // The header ends with '---\n\n', so we find that boundary.
    const headerEnd = current.indexOf('---\n\n');
    if (headerEnd === -1) {
      // Fallback: file exists but has unexpected structure — prepend entry.
      fs.writeFileSync(changelogPath, entry + current, 'utf8');
    } else {
      const insertAt = headerEnd + '---\n\n'.length;
      const updated = current.slice(0, insertAt) + entry + current.slice(insertAt);
      fs.writeFileSync(changelogPath, updated, 'utf8');
    }
  } catch (err) {
    // Never throw — changelog write failure must not block ontology-sync.
    process.stderr.write(`[ontology-changelog] write failed: ${err.message}\n`);
  }
}

module.exports = { appendEntry, buildEntry, today };
