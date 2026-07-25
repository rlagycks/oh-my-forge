#!/usr/bin/env node
/**
 * PostToolUse hook that records metadata-only observations for edited files
 * owned by a project ontology. It intentionally does not infer ontology
 * updates; deferred maintenance is responsible for candidate generation.
 *
 * Enable with ECC_ONTOLOGY_OBSERVATION_CAPTURE=1.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadOntologyMaps,
  matchFileToDomain,
  resolveProjectOntologyRoot,
} = require('../lib/ontology-routing');

const SCHEMA_VERSION = 1;
const EVENT_TYPE = 'file_changed';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getObservationLogPath() {
  return process.env.OMF_ONTOLOGY_OBSERVATION_LOG
    ? path.resolve(process.env.OMF_ONTOLOGY_OBSERVATION_LOG)
    : path.join(os.homedir(), '.claude', 'ecc', 'ontology-observations.jsonl');
}

function collectFilePaths(toolInput = {}) {
  const candidates = [toolInput.file_path, toolInput.path];
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      candidates.push(edit?.file_path, edit?.path);
    }
  }
  return [...new Set(candidates.filter(value => typeof value === 'string' && value.trim() !== ''))]
    .map(value => path.resolve(value));
}

function getSessionKey(sessionId, cwd) {
  const raw = String(sessionId || `cwd:${cwd}`);
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}

function claimDedupe(logPath, sessionId, fingerprint, cwd) {
  const markerPath = path.join(
    `${logPath}.dedup`,
    getSessionKey(sessionId, cwd),
    fingerprint
  );
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    const descriptor = fs.openSync(markerPath, 'wx');
    fs.closeSync(descriptor);
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function appendObservation(observation, logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(observation)}\n`, 'utf8');
}

function createObservation({ filePath, projectRoot, domainKey, sessionId, now }) {
  let contentFingerprint;
  try {
    contentFingerprint = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }

  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) return null;

  const observedAt = now || new Date().toISOString();
  const dedupeKey = sha256(`${sessionId || ''}:${domainKey}:${relativePath}:${contentFingerprint}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `ontology-observation-${dedupeKey.slice(0, 24)}`,
    eventType: EVENT_TYPE,
    sessionId: sessionId || null,
    projectRoot,
    domainKey,
    filePath: relativePath,
    contentFingerprint,
    observedAt,
  };
}

function captureObservations(rawInput, options = {}) {
  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    return [];
  }

  const logPath = options.logPath || getObservationLogPath();
  const sessionId = options.sessionId ?? process.env.CLAUDE_SESSION_ID ?? null;
  const cwd = options.cwd || process.cwd();
  const captured = [];

  for (const filePath of collectFilePaths(input.tool_input)) {
    const projectRoot = resolveProjectOntologyRoot({ filePath, cwd });
    if (!projectRoot) continue;

    const { fileMap } = loadOntologyMaps(projectRoot);
    const entry = matchFileToDomain({ filePath, ontologyRoot: projectRoot, fileMap });
    if (!entry?.domainKey) continue;

    const observation = createObservation({
      filePath,
      projectRoot,
      domainKey: entry.domainKey,
      sessionId,
      now: options.now,
    });
    if (!observation) continue;

    try {
      if (!claimDedupe(logPath, sessionId, observation.id, cwd)) continue;
      appendObservation(observation, logPath);
      captured.push(observation);
    } catch {
      // Best effort only: observation capture must never affect editing.
    }
  }

  return captured;
}

function run(rawInput, options = {}) {
  if (String(process.env.ECC_ONTOLOGY_OBSERVATION_CAPTURE || '').toLowerCase() !== '1') {
    return rawInput;
  }
  try {
    captureObservations(rawInput, options);
  } catch {
    // Fail open: PostToolUse capture must not break the tool pipeline.
  }
  return rawInput;
}

module.exports = {
  EVENT_TYPE,
  SCHEMA_VERSION,
  captureObservations,
  collectFilePaths,
  createObservation,
  getObservationLogPath,
  run,
};

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    process.stdout.write(run(raw));
  });
}
