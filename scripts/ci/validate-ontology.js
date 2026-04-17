#!/usr/bin/env node
/**
 * Validate .claude/ontology/index.json:
 *  - index.json is parseable JSON
 *  - all keys follow domain_* naming
 *  - each entry has required fields: files[], spec, codexWorkerHint
 *  - all files[] paths exist on disk
 *  - all spec paths exist on disk
 *  - each spec doc contains the 4 required H2 sections
 *  - docs/features/index.md row count matches domain key count
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../');
const ONTOLOGY_DIR = path.join(ROOT, '.claude/ontology');
const INDEX_PATH = path.join(ONTOLOGY_DIR, 'index.json');
const FEATURES_INDEX = path.join(ROOT, 'docs/features/index.md');

const REQUIRED_ENTRY_FIELDS = ['files', 'spec', 'codexWorkerHint'];
const VALID_WORKER_HINTS = ['workspace-write', 'read-only'];
const REQUIRED_H2_SECTIONS = ['## 목적', '## 진입점', '## 핵심 제약', '## 관련 도메인'];
const DOMAIN_KEY_PATTERN = /^domain_[a-z][a-z0-9_]*$/;
const VALID_DECAY_STATUSES = new Set(['active', 'deprecated', 'stale', 'superseded']);
const DECAY_DATE_FIELDS = ['createdAt', 'updatedAt', 'lastSeenAt', 'expiresAt'];

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validateDecayMetadata(domainKey, detailPath, itemPath, item, reportError) {
  if (!item || typeof item !== 'object') return;

  if (item.status !== undefined && !VALID_DECAY_STATUSES.has(item.status)) {
    reportError(
      `ERROR: ${domainKey} — ${itemPath}.status must be one of: ${[...VALID_DECAY_STATUSES].join(', ')} (${detailPath})`
    );
  }

  for (const field of DECAY_DATE_FIELDS) {
    if (item[field] === undefined) continue;
    if (typeof item[field] !== 'string' || Number.isNaN(Date.parse(item[field]))) {
      reportError(`ERROR: ${domainKey} — ${itemPath}.${field} must be a parseable date string (${detailPath})`);
    }
  }

  for (const field of ['supersededBy', 'replacedBy']) {
    if (item[field] !== undefined && typeof item[field] !== 'string') {
      reportError(`ERROR: ${domainKey} — ${itemPath}.${field} must be a string (${detailPath})`);
    }
  }
}

function validateDetailShape(domainKey, detailPath, detail, reportError) {
  if (detail.executionContract) {
    if (typeof detail.executionContract !== 'object' || Array.isArray(detail.executionContract)) {
      reportError(`ERROR: ${domainKey} — detail.executionContract must be an object (${detailPath})`);
    }
    for (const field of ['notDo', 'success', 'approvalBoundary', 'blockOn']) {
      if (detail.executionContract[field] && !isStringArray(detail.executionContract[field])) {
        reportError(`ERROR: ${domainKey} — detail.executionContract.${field} must be a string array (${detailPath})`);
      }
    }
  }

  if (detail.completionContract) {
    if (typeof detail.completionContract !== 'object' || Array.isArray(detail.completionContract)) {
      reportError(`ERROR: ${domainKey} — detail.completionContract must be an object (${detailPath})`);
    }
    for (const field of ['requiredEvidence', 'falseNormalChecks', 'handoffTemplate']) {
      if (detail.completionContract[field] && !isStringArray(detail.completionContract[field])) {
        reportError(`ERROR: ${domainKey} — detail.completionContract.${field} must be a string array (${detailPath})`);
      }
    }
  }

  if (detail.failurePatterns) {
    if (!Array.isArray(detail.failurePatterns)) {
      reportError(`ERROR: ${domainKey} — detail.failurePatterns must be an array (${detailPath})`);
    } else {
      for (const pattern of detail.failurePatterns) {
        if (!pattern || typeof pattern !== 'object') {
          reportError(`ERROR: ${domainKey} — failurePatterns entries must be objects (${detailPath})`);
          continue;
        }
        for (const field of ['id', 'symptom', 'looksNormalIf', 'actuallyMeans', 'nextSuspicion']) {
          if (typeof pattern[field] !== 'string' || pattern[field].trim().length === 0) {
            reportError(`ERROR: ${domainKey} — failurePatterns entries require non-empty ${field} (${detailPath})`);
          }
        }
        if (!isStringArray(pattern.verifyWith || [])) {
          reportError(`ERROR: ${domainKey} — failurePatterns.verifyWith must be a string array (${detailPath})`);
        }
        validateDecayMetadata(domainKey, detailPath, `failurePatterns.${pattern.id || '(unknown)'}`, pattern, reportError);
      }
    }
  }

  if (detail.decisions) {
    if (!Array.isArray(detail.decisions)) {
      reportError(`ERROR: ${domainKey} — detail.decisions must be an array (${detailPath})`);
    } else {
      for (const decision of detail.decisions) {
        validateDecayMetadata(domainKey, detailPath, `decisions.${decision?.id || decision?.summary || '(unknown)'}`, decision, reportError);
      }
    }
  }

  if (detail.retrievalProfiles) {
    if (typeof detail.retrievalProfiles !== 'object' || Array.isArray(detail.retrievalProfiles)) {
      reportError(`ERROR: ${domainKey} — detail.retrievalProfiles must be an object (${detailPath})`);
    } else {
      for (const [profileName, profile] of Object.entries(detail.retrievalProfiles)) {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
          reportError(`ERROR: ${domainKey} — retrieval profile ${profileName} must be an object (${detailPath})`);
          continue;
        }
        if (!isStringArray(profile.include || [])) {
          reportError(`ERROR: ${domainKey} — retrieval profile ${profileName} include must be a string array (${detailPath})`);
        }
      }
    }
  }
}

function validateOntology() {
  if (!fs.existsSync(ONTOLOGY_DIR)) {
    console.log('No .claude/ontology directory found, skipping validation');
    process.exit(0);
  }

  if (!fs.existsSync(INDEX_PATH)) {
    console.error('ERROR: .claude/ontology/index.json not found');
    process.exit(1);
  }

  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse index.json — ${err.message}`);
    process.exit(1);
  }

  let hasErrors = false;
  // Only validate keys that start with "domain_"; skip meta-keys like "$schema"
  const domainKeys = Object.keys(index).filter(k => k.startsWith('domain_'));
  const nonDomainKeys = Object.keys(index).filter(k => !k.startsWith('domain_') && k !== '$schema');

  for (const key of nonDomainKeys) {
    console.error(`ERROR: unexpected non-domain key "${key}" — only domain_* and $schema keys are allowed`);
    hasErrors = true;
  }

  for (const key of domainKeys) {
    if (!DOMAIN_KEY_PATTERN.test(key)) {
      console.error(`ERROR: key "${key}" does not match domain_[a-z][a-z0-9_]* pattern`);
      hasErrors = true;
      continue;
    }

    const entry = index[key];

    // Required fields
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!entry[field]) {
        console.error(`ERROR: ${key} — missing required field: ${field}`);
        hasErrors = true;
      }
    }

    // files[] must be an array and all paths must exist
    if (Array.isArray(entry.files)) {
      if (entry.files.length === 0) {
        console.error(`ERROR: ${key} — files[] must not be empty`);
        hasErrors = true;
      }
      for (const filePath of entry.files) {
        const abs = path.join(ROOT, filePath);
        if (!fs.existsSync(abs)) {
          console.error(`ERROR: ${key} — files[] path not found: ${filePath}`);
          hasErrors = true;
        }
      }
    } else if (entry.files !== undefined) {
      console.error(`ERROR: ${key} — files must be an array`);
      hasErrors = true;
    }

    // spec path must exist
    if (entry.spec) {
      const specAbs = path.join(ROOT, entry.spec);
      if (!fs.existsSync(specAbs)) {
        console.error(`ERROR: ${key} — spec not found: ${entry.spec}`);
        hasErrors = true;
      } else {
        // Check spec doc has all 4 required H2 sections
        const specContent = fs.readFileSync(specAbs, 'utf-8');
        for (const section of REQUIRED_H2_SECTIONS) {
          if (!specContent.includes(section)) {
            console.error(`ERROR: ${key} — spec ${entry.spec} missing section: ${section}`);
            hasErrors = true;
          }
        }
      }
    }

    if (entry.detail) {
      const detailAbs = path.join(ROOT, entry.detail);
      if (!fs.existsSync(detailAbs)) {
        console.error(`ERROR: ${key} — detail not found: ${entry.detail}`);
        hasErrors = true;
      } else {
        try {
          const detail = JSON.parse(fs.readFileSync(detailAbs, 'utf8'));
          validateDetailShape(key, entry.detail, detail, message => {
            console.error(message);
            hasErrors = true;
          });
        } catch (err) {
          console.error(`ERROR: ${key} — failed to parse detail ${entry.detail}: ${err.message}`);
          hasErrors = true;
        }
      }
    }

    // codexWorkerHint must be valid
    if (entry.codexWorkerHint && !VALID_WORKER_HINTS.includes(entry.codexWorkerHint)) {
      console.error(`ERROR: ${key} — invalid codexWorkerHint "${entry.codexWorkerHint}". Must be: ${VALID_WORKER_HINTS.join(' | ')}`);
      hasErrors = true;
    }
  }

  // Cross-check: docs/features/index.md row count must match domain key count
  if (fs.existsSync(FEATURES_INDEX)) {
    const mdContent = fs.readFileSync(FEATURES_INDEX, 'utf-8');
    const tableRows = mdContent.match(/^\|\s*`domain_/gm);
    const mdDomainCount = tableRows ? tableRows.length : 0;
    if (mdDomainCount !== domainKeys.length) {
      console.error(
        `ERROR: docs/features/index.md has ${mdDomainCount} domain row(s) but index.json has ${domainKeys.length} domain key(s) — keep them in sync`
      );
      hasErrors = true;
    }
  } else {
    console.error('ERROR: docs/features/index.md not found');
    hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`Validated ${domainKeys.length} ontology domain(s)`);
}

validateOntology();
