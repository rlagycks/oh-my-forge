'use strict';

const assert = require('assert');

const {
  DEFAULT_RETRIEVAL_PROFILES,
  buildContractFieldsFromPacket,
  buildDomainPacket,
} = require('../../scripts/lib/ontology-packet');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\nontology-packet.test.js');

if (test('buildDomainPacket keeps only the fields selected by the retrieval profile', () => {
  const entry = {
    domainKey: 'domain_sample',
    owner: 'hooks',
    riskLevel: 'high',
    summary: 'sample summary',
    spec: 'docs/features/sample.md',
    constraints: ['Do not widen scope'],
    symbols: ['run'],
    executionContract: {
      success: ['Finish scoped change'],
      notDo: ['Do not rewrite the runtime'],
    },
    completionContract: {
      requiredEvidence: ['Tests prove the change'],
      falseNormalChecks: ['A green summary without evidence is not done'],
    },
    failurePatterns: [
      {
        id: 'first',
        symptom: 'first symptom',
        looksNormalIf: 'logs look clean',
        actuallyMeans: 'guard was skipped',
        verifyWith: ['inspect packet'],
        nextSuspicion: 'routing mismatch',
      },
      {
        id: 'second',
        symptom: 'second symptom',
        looksNormalIf: 'tests are skipped',
        actuallyMeans: 'fallback ran instead',
        verifyWith: ['inspect runtime'],
        nextSuspicion: 'schema drift',
      },
    ],
    decisions: [
      { id: 'dec-1', summary: 'one' },
      { id: 'dec-2', summary: 'two' },
    ],
    retrievalProfiles: {
      implement: {
        include: [
          'summary',
          'executionContract.success',
          'completionContract.falseNormalChecks',
          'failurePatterns',
          'decisions',
        ],
        maxFailurePatterns: 1,
        maxDecisions: 1,
      },
    },
  };

  const packet = buildDomainPacket(entry, 'implement');

  assert.strictEqual(packet.domainKey, 'domain_sample');
  assert.strictEqual(packet.owner, 'hooks');
  assert.strictEqual(packet.summary, 'sample summary');
  assert.deepStrictEqual(packet.executionContract.success, ['Finish scoped change']);
  assert.deepStrictEqual(packet.completionContract.falseNormalChecks, [
    'A green summary without evidence is not done',
  ]);
  assert.strictEqual(packet.failurePatterns.length, 1);
  assert.strictEqual(packet.failurePatterns[0].id, 'first');
  assert.strictEqual(packet.decisions.length, 1);
  assert.strictEqual(packet.decisions[0].id, 'dec-1');
  assert.ok(!packet.spec, JSON.stringify(packet, null, 2));
  assert.ok(!packet.constraints, JSON.stringify(packet, null, 2));
  assert.ok(!packet.executionContract.notDo, JSON.stringify(packet, null, 2));
})) passed++; else failed++;

if (test('buildDomainPacket prefers fresh active decisions over stale design residue', () => {
  const entry = {
    domainKey: 'domain_decay',
    owner: 'ontology',
    decisions: [
      { id: 'dec-old', date: '2026-01-01', status: 'active', summary: 'old active decision' },
      { id: 'dec-expired', date: '2026-04-16', expiresAt: '2026-04-17', summary: 'expired decision' },
      { id: 'dec-deprecated', date: '2026-04-15', status: 'deprecated', summary: 'deprecated decision' },
      { id: 'dec-new', date: '2026-04-18', summary: 'new active decision' },
      { id: 'dec-mid', date: '2026-04-12', status: 'active', summary: 'mid active decision' },
    ],
    retrievalProfiles: {
      implement: {
        include: ['decisions'],
        maxDecisions: 2,
      },
    },
  };

  const packet = buildDomainPacket(entry, 'implement', { now: '2026-04-18T00:00:00Z' });

  assert.deepStrictEqual(packet.decisions.map(decision => decision.id), ['dec-new', 'dec-mid']);
})) passed++; else failed++;

if (test('buildDomainPacket skips expired or deprecated failure patterns before truncating', () => {
  const makePattern = (id, overrides = {}) => ({
    id,
    symptom: `${id} symptom`,
    looksNormalIf: `${id} looks normal`,
    actuallyMeans: `${id} actual meaning`,
    verifyWith: [`verify ${id}`],
    nextSuspicion: `${id} suspicion`,
    ...overrides,
  });
  const entry = {
    domainKey: 'domain_decay',
    owner: 'ontology',
    failurePatterns: [
      makePattern('old-active', { lastSeenAt: '2026-01-01' }),
      makePattern('expired', { lastSeenAt: '2026-04-15', expiresAt: '2026-04-17' }),
      makePattern('deprecated', { lastSeenAt: '2026-04-16', status: 'deprecated' }),
      makePattern('recent-active', { lastSeenAt: '2026-04-17' }),
      makePattern('mid-active', { lastSeenAt: '2026-04-10', status: 'active' }),
    ],
    retrievalProfiles: {
      implement: {
        include: ['failurePatterns'],
        maxFailurePatterns: 2,
      },
    },
  };

  const packet = buildDomainPacket(entry, 'implement', { now: '2026-04-18T00:00:00Z' });

  assert.deepStrictEqual(packet.failurePatterns.map(pattern => pattern.id), ['recent-active', 'mid-active']);
})) passed++; else failed++;

if (test('buildDomainPacket falls back to default context profile when a domain does not define one', () => {
  const entry = {
    domainKey: 'domain_default',
    owner: 'commands',
    summary: 'default summary',
    spec: 'docs/features/default.md',
    constraints: ['Keep the command compact'],
    symbols: ['createPlanRoute'],
    dependsOn: ['domain_common'],
    completionContract: {
      falseNormalChecks: ['Do not inject the whole ontology by default'],
    },
    failurePatterns: [
      {
        id: 'default-guard',
        symptom: 'packet too large',
        looksNormalIf: 'context looks rich',
        actuallyMeans: 'too much unrelated detail was loaded',
        verifyWith: ['inspect context packet'],
        nextSuspicion: 'missing include list',
      },
    ],
  };

  const packet = buildDomainPacket(entry, 'context');

  assert.deepStrictEqual(packet.summary, 'default summary');
  assert.deepStrictEqual(packet.spec, 'docs/features/default.md');
  assert.deepStrictEqual(packet.constraints, ['Keep the command compact']);
  assert.deepStrictEqual(packet.symbols, ['createPlanRoute']);
  assert.deepStrictEqual(packet.dependsOn, ['domain_common']);
  assert.strictEqual(packet.failurePatterns.length, DEFAULT_RETRIEVAL_PROFILES.context.maxFailurePatterns);
  assert.ok(!packet.executionContract, JSON.stringify(packet, null, 2));
})) passed++; else failed++;

if (test('buildContractFieldsFromPacket turns the packet into handoff checklists', () => {
  const packet = {
    executionContract: {
      success: ['Finish the scoped hook change'],
      notDo: ['Do not add network calls'],
    },
    completionContract: {
      requiredEvidence: ['Show the changed hook output'],
      falseNormalChecks: ['A silent hook is not proof of safety'],
    },
    failurePatterns: [
      {
        symptom: 'hook is quiet',
        nextSuspicion: 'root mismatch',
      },
    ],
  };

  const fields = buildContractFieldsFromPacket(packet);

  assert.deepStrictEqual(fields.successCriteria, ['Finish the scoped hook change']);
  assert.ok(fields.notDo.includes('Do not add network calls'), JSON.stringify(fields));
  assert.ok(fields.notDo.includes('hook is quiet -> root mismatch'), JSON.stringify(fields));
  assert.ok(fields.completionChecks.includes('Show the changed hook output'), JSON.stringify(fields));
  assert.ok(fields.completionChecks.includes('A silent hook is not proof of safety'), JSON.stringify(fields));
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
