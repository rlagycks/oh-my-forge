#!/usr/bin/env node
/**
 * Deferred ontology maintenance worker.
 *
 * Runs only at an asynchronous lifecycle boundary. PostToolUse capture stays
 * metadata-only and never opens the state store. This worker materializes
 * review candidates; it never edits ontology or documentation files.
 */

'use strict';

const { getObservationLogPath } = require('./ontology-observation-capture');
const { drainOntologyObservationSpool } = require('../lib/ontology-observation-drainer');
const { createStateStore } = require('../lib/state-store');

function isEnabled() {
  return String(process.env.ECC_ONTOLOGY_MAINTENANCE || '').toLowerCase() === '1';
}

async function maintainOntologyCandidates() {
  return drainOntologyObservationSpool({
    logPath: getObservationLogPath(),
    createStateStore,
  });
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', async () => {
    if (isEnabled()) {
      try {
        const result = await maintainOntologyCandidates();
        process.stderr.write(`[OntologyMaintenance] ${result.status}: ${result.created} created, ${result.updated} updated, ${result.rejected} rejected\n`);
      } catch (error) {
        // Lifecycle work is advisory: never interrupt the host tool/session.
        process.stderr.write(`[OntologyMaintenance] skipped: ${error.message}\n`);
      }
    }
    process.stdout.write(raw);
  });
  process.stdin.on('error', () => process.stdout.write(raw));
}

main();
