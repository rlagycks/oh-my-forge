'use strict';

const EVIDENCE_STATES = Object.freeze({
  OBSERVED: 'observed',
  INFERRED: 'inferred',
  VERIFIED: 'verified',
  STALE: 'stale',
  SUPERSEDED: 'superseded',
  UNKNOWN: 'unknown',
  FAILED: 'failed',
});

const VALID_STATES = new Set(Object.values(EVIDENCE_STATES));
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_RECEIPT_FIELDS = Object.freeze([
  'prompt',
  'output',
  'rawOutput',
  'raw_output',
  'sourceCode',
  'source_code',
]);

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isPortableSubject(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value);
}

function hasDurableArtifact(receipt = {}) {
  if (isSha256(receipt.snapshotHash)) return true;

  return receipt.fileHashes
    && typeof receipt.fileHashes === 'object'
    && !Array.isArray(receipt.fileHashes)
    && Object.values(receipt.fileHashes).some(isSha256);
}

function deriveVerificationOutcome(receipt = {}) {
  if (receipt.timedOut === true) {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'timed-out' };
  }

  if (typeof receipt.signal === 'string' && receipt.signal.trim() !== '') {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'signaled' };
  }

  if (!Number.isInteger(receipt.exitCode)) {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'missing-exit-code' };
  }

  if (receipt.exitCode !== 0) {
    return { state: EVIDENCE_STATES.FAILED, reason: 'nonzero-exit' };
  }

  if (!hasDurableArtifact(receipt)) {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'missing-artifact' };
  }

  return { state: EVIDENCE_STATES.VERIFIED, reason: 'verified-receipt' };
}

function createVerificationReceipt(options = {}) {
  const receipt = {
    verifierId: options.verifierId,
    subject: options.subject,
    exitCode: Number.isInteger(options.exitCode) ? options.exitCode : null,
    timedOut: options.timedOut === true,
    signal: typeof options.signal === 'string' && options.signal.trim() !== '' ? options.signal.trim() : null,
    ...(isSha256(options.snapshotHash) ? { snapshotHash: options.snapshotHash } : {}),
    ...(options.fileHashes && typeof options.fileHashes === 'object' && !Array.isArray(options.fileHashes)
      ? { fileHashes: { ...options.fileHashes } }
      : {}),
    ...(isIsoTimestamp(options.startedAt) ? { startedAt: options.startedAt } : {}),
    ...(isIsoTimestamp(options.endedAt) ? { endedAt: options.endedAt } : {}),
  };
  const outcome = deriveVerificationOutcome(receipt);

  return {
    ...receipt,
    state: outcome.state,
    reason: outcome.reason,
  };
}

function validateVerificationReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { valid: false, errors: ['receipt must be an object'] };
  }

  if (typeof receipt.verifierId !== 'string' || receipt.verifierId.trim() === '') {
    errors.push('verifierId must be a non-empty string');
  }

  if (!isPortableSubject(receipt.subject)) {
    errors.push('subject must be a non-empty relative identifier');
  }

  if (!VALID_STATES.has(receipt.state)) {
    errors.push(`state must be one of ${Array.from(VALID_STATES).join(', ')}`);
  }

  if (typeof receipt.reason !== 'string' || receipt.reason.trim() === '') {
    errors.push('reason must be a non-empty string');
  }

  if (receipt.exitCode !== null && !Number.isInteger(receipt.exitCode)) {
    errors.push('exitCode must be an integer or null');
  }

  if (typeof receipt.timedOut !== 'boolean') {
    errors.push('timedOut must be boolean');
  }

  if (receipt.signal !== null && (typeof receipt.signal !== 'string' || receipt.signal.trim() === '')) {
    errors.push('signal must be a non-empty string or null');
  }

  for (const field of ['snapshotHash']) {
    if (receipt[field] !== undefined && !isSha256(receipt[field])) {
      errors.push(`${field} must be a sha256 hash`);
    }
  }

  if (receipt.fileHashes !== undefined) {
    if (!receipt.fileHashes || typeof receipt.fileHashes !== 'object' || Array.isArray(receipt.fileHashes)) {
      errors.push('fileHashes must be an object');
    } else {
      for (const [filePath, hash] of Object.entries(receipt.fileHashes)) {
        if (!isPortableSubject(filePath) || !isSha256(hash)) {
          errors.push('fileHashes must map relative paths to sha256 hashes');
          break;
        }
      }
    }
  }

  for (const field of ['startedAt', 'endedAt']) {
    if (receipt[field] !== undefined && !isIsoTimestamp(receipt[field])) {
      errors.push(`${field} must be an ISO-8601 timestamp`);
    }
  }

  for (const field of FORBIDDEN_RECEIPT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(receipt, field)) {
      errors.push(`${field} is not allowed in a durable verification receipt`);
    }
  }

  const expected = deriveVerificationOutcome(receipt);
  if (receipt.state !== expected.state) {
    errors.push(`state must be ${expected.state} for this execution outcome`);
  }
  if (receipt.reason !== expected.reason) {
    errors.push(`reason must be ${expected.reason} for this execution outcome`);
  }

  return { valid: errors.length === 0, errors };
}

function assertValidVerificationReceipt(receipt) {
  const result = validateVerificationReceipt(receipt);
  if (!result.valid) {
    throw new Error(`Invalid verification receipt: ${result.errors.join('; ')}`);
  }
  return receipt;
}

module.exports = {
  EVIDENCE_STATES,
  FORBIDDEN_RECEIPT_FIELDS,
  assertValidVerificationReceipt,
  createVerificationReceipt,
  deriveVerificationOutcome,
  hasDurableArtifact,
  validateVerificationReceipt,
};
