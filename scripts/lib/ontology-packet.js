'use strict';

const { uniqueStrings } = require('./ontology-routing');

const DEFAULT_RETRIEVAL_PROFILES = {
  implement: {
    include: [
      'summary',
      'constraints',
      'symbols',
      'dependsOn',
      'executionContract.success',
      'executionContract.notDo',
      'completionContract.requiredEvidence',
      'completionContract.falseNormalChecks',
      'failurePatterns',
    ],
    maxFailurePatterns: 1,
    maxDecisions: 2,
  },
  handoff: {
    include: [
      'summary',
      'executionContract.success',
      'completionContract.handoffTemplate',
      'completionContract.falseNormalChecks',
      'failurePatterns',
    ],
    maxFailurePatterns: 1,
    maxDecisions: 1,
  },
  context: {
    include: [
      'summary',
      'spec',
      'symbols',
      'constraints',
      'dependsOn',
      'completionContract.falseNormalChecks',
      'failurePatterns',
    ],
    maxFailurePatterns: 1,
    maxDecisions: 0,
  },
};

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function getPathValue(target, fieldPath) {
  return String(fieldPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), target);
}

function setPathValue(target, fieldPath, value) {
  const keys = String(fieldPath || '').split('.').filter(Boolean);
  if (keys.length === 0) return;

  let cursor = target;
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = cloneValue(value);
}

function normalizeProfile(profileName, entry = {}, fallbackProfiles = DEFAULT_RETRIEVAL_PROFILES) {
  const explicitProfile = entry.retrievalProfiles && typeof entry.retrievalProfiles === 'object'
    ? entry.retrievalProfiles[profileName]
    : null;
  const fallbackProfile = fallbackProfiles[profileName] || null;
  const include = uniqueStrings(explicitProfile?.include || fallbackProfile?.include || []);

  return {
    include,
    maxFailurePatterns: Number.isInteger(explicitProfile?.maxFailurePatterns)
      ? explicitProfile.maxFailurePatterns
      : Number.isInteger(fallbackProfile?.maxFailurePatterns)
        ? fallbackProfile.maxFailurePatterns
        : null,
    maxDecisions: Number.isInteger(explicitProfile?.maxDecisions)
      ? explicitProfile.maxDecisions
      : Number.isInteger(fallbackProfile?.maxDecisions)
        ? fallbackProfile.maxDecisions
        : null,
  };
}

function truncateList(items, maxItems) {
  if (!Array.isArray(items)) return [];
  if (maxItems === null) return items.map(item => cloneValue(item));
  if (maxItems <= 0) return [];
  return items.slice(0, maxItems).map(item => cloneValue(item));
}

function buildDomainPacket(entry = {}, profileName = 'implement', options = {}) {
  const profile = normalizeProfile(profileName, entry, options.fallbackProfiles);
  const packet = {
    domainKey: entry.domainKey,
    owner: entry.owner,
    riskLevel: entry.riskLevel,
  };

  for (const field of profile.include) {
    if (field === 'failurePatterns') {
      if (Array.isArray(entry.failurePatterns) && entry.failurePatterns.length > 0) {
        packet.failurePatterns = truncateList(entry.failurePatterns, profile.maxFailurePatterns);
      }
      continue;
    }

    if (field === 'decisions') {
      if (Array.isArray(entry.decisions) && entry.decisions.length > 0) {
        packet.decisions = truncateList(entry.decisions, profile.maxDecisions);
      }
      continue;
    }

    const value = getPathValue(entry, field);
    if (value === undefined) continue;
    setPathValue(packet, field, value);
  }

  return packet;
}

function buildContractFieldsFromPacket(packet = {}) {
  const failureNotes = Array.isArray(packet.failurePatterns)
    ? packet.failurePatterns.map(pattern => `${pattern.symptom} -> ${pattern.nextSuspicion}`)
    : [];

  return {
    successCriteria: uniqueStrings(packet.executionContract?.success || []),
    notDo: uniqueStrings([
      ...(packet.executionContract?.notDo || []),
      ...failureNotes,
    ]),
    completionChecks: uniqueStrings([
      ...(packet.completionContract?.requiredEvidence || []),
      ...(packet.completionContract?.falseNormalChecks || []),
    ]),
  };
}

module.exports = {
  DEFAULT_RETRIEVAL_PROFILES,
  buildContractFieldsFromPacket,
  buildDomainPacket,
};
