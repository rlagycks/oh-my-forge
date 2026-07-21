'use strict';

const crypto = require('crypto');

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
const ATTESTATION_SIGNATURE_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;
const STRICT_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORBIDDEN_RECEIPT_FIELDS = Object.freeze([
  'prompt',
  'output',
  'rawOutput',
  'raw_output',
  'sourceCode',
  'source_code',
]);
const RECEIPT_FIELDS = new Set([
  'verifierId',
  'subject',
  'executionId',
  'exitCode',
  'timedOut',
  'signal',
  'snapshotHash',
  'fileHashes',
  'persistenceAttestation',
  'startedAt',
  'endedAt',
  'state',
  'reason',
]);
const ATTESTATION_FIELDS = new Set(['artifactId', 'persistedAt', 'signature']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStrictUtcTimestamp(value) {
  return typeof value === 'string'
    && STRICT_UTC_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function containsControlCharacters(value) {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function isPortableIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (value !== value.trim() || containsControlCharacters(value)) return false;
  if (value.includes('\\') || value.includes('://') || /^[a-zA-Z]:/.test(value)) return false;

  const segments = value.split('/');
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function validateFileHashes(fileHashes) {
  if (!isPlainObject(fileHashes)) return ['fileHashes must be an object'];

  const errors = [];
  for (const [filePath, hash] of Object.entries(fileHashes)) {
    if (!isPortableIdentifier(filePath) || !isSha256(hash)) {
      errors.push('fileHashes must map safe relative identifiers to sha256 hashes');
      break;
    }
  }
  return errors;
}

function getAttestationSecret() {
  const secret = process.env.OMF_EVIDENCE_ATTESTATION_SECRET;
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

function buildAttestationPayload({
  verifierId,
  subject,
  executionId,
  exitCode,
  timedOut,
  signal,
  startedAt,
  endedAt,
  snapshotHash,
  artifactId,
  persistedAt,
}) {
  return [
    verifierId,
    subject,
    executionId,
    exitCode,
    timedOut,
    signal,
    startedAt,
    endedAt,
    snapshotHash,
    artifactId,
    persistedAt,
  ].join('\n');
}

function createAttestationSignature(fields, secret) {
  return `hmac-sha256:${crypto.createHmac('sha256', secret)
    .update(buildAttestationPayload(fields), 'utf8')
    .digest('hex')}`;
}

function signaturesMatch(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function validatePersistenceAttestation(attestation, receipt, { verifySignature = false } = {}) {
  if (!isPlainObject(attestation)) return ['persistenceAttestation must be an object'];

  const errors = [];
  for (const key of Object.keys(attestation)) {
    if (!ATTESTATION_FIELDS.has(key)) {
      errors.push(`persistenceAttestation.${key} is not allowed`);
    }
  }
  if (!isPortableIdentifier(attestation.artifactId)) {
    errors.push('persistenceAttestation.artifactId must be a safe relative identifier');
  }
  if (!isStrictUtcTimestamp(attestation.persistedAt)) {
    errors.push('persistenceAttestation.persistedAt must be a strict UTC ISO-8601 timestamp');
  }
  if (!ATTESTATION_SIGNATURE_PATTERN.test(attestation.signature || '')) {
    errors.push('persistenceAttestation.signature must be an HMAC-SHA256 signature');
  }

  if (verifySignature && !getAttestationSecret()) {
    errors.push('OMF_EVIDENCE_ATTESTATION_SECRET must be configured to verify persistence attestations');
  } else if (verifySignature && errors.length === 0) {
    const secret = getAttestationSecret();
    const expected = createAttestationSignature({
      verifierId: receipt?.verifierId,
      subject: receipt?.subject,
      executionId: receipt?.executionId,
      exitCode: receipt?.exitCode,
      timedOut: receipt?.timedOut,
      signal: receipt?.signal,
      startedAt: receipt?.startedAt,
      endedAt: receipt?.endedAt,
      snapshotHash: receipt?.snapshotHash,
      artifactId: attestation.artifactId,
      persistedAt: attestation.persistedAt,
    }, secret);
    if (!signaturesMatch(attestation.signature, expected)) {
      errors.push('persistenceAttestation.signature must bind verifierId, subject, snapshotHash, artifactId, and persistedAt');
    }
  }
  return errors;
}

function hasDurableArtifact(receipt, options = {}) {
  if (!isPlainObject(receipt) || !isSha256(receipt.snapshotHash)) return false;
  if (!isPortableIdentifier(receipt.executionId)
    || !Number.isInteger(receipt.exitCode)
    || typeof receipt.timedOut !== 'boolean'
    || !isStrictUtcTimestamp(receipt.startedAt)
    || !isStrictUtcTimestamp(receipt.endedAt)
    || Date.parse(receipt.endedAt) < Date.parse(receipt.startedAt)) return false;
  return validatePersistenceAttestation(receipt.persistenceAttestation, receipt, options).length === 0;
}

function createPersistenceAttestation(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('persistence attestation options must be an object');
  const {
    verifierId, subject, executionId, exitCode, timedOut, signal, startedAt, endedAt, snapshotHash, artifactId, persistedAt,
  } = options;
  if (!isPortableIdentifier(verifierId) || !isPortableIdentifier(subject) || !isPortableIdentifier(executionId)
    || !Number.isInteger(exitCode) || typeof timedOut !== 'boolean'
    || (signal !== null && !isPortableIdentifier(signal))
    || !isStrictUtcTimestamp(startedAt) || !isStrictUtcTimestamp(endedAt)
    || Date.parse(endedAt) < Date.parse(startedAt)
    || !isSha256(snapshotHash) || !isPortableIdentifier(artifactId) || !isStrictUtcTimestamp(persistedAt)) {
    throw new TypeError('persistence attestation fields must bind one complete execution to a verifier, subject, snapshot, artifact, and strict UTC timestamp');
  }
  const secret = getAttestationSecret();
  if (!secret) {
    throw new Error('OMF_EVIDENCE_ATTESTATION_SECRET must be configured to create persistence attestations');
  }
  const signature = createAttestationSignature(
    { verifierId, subject, executionId, exitCode, timedOut, signal, startedAt, endedAt, snapshotHash, artifactId, persistedAt },
    secret
  );
  return { artifactId, persistedAt, signature };
}

function deriveVerificationOutcome(input, options = {}) {
  const receipt = isPlainObject(input) ? input : {};
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

  if (!isSha256(receipt.snapshotHash)) {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'missing-artifact' };
  }

  if (!hasDurableArtifact(receipt, options)) {
    return { state: EVIDENCE_STATES.UNKNOWN, reason: 'missing-persistence-attestation' };
  }

  return { state: EVIDENCE_STATES.VERIFIED, reason: 'verified-receipt' };
}

function assertCreateOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('verification receipt options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!RECEIPT_FIELDS.has(key)) {
      throw new TypeError(`verification receipt option ${key} is not allowed`);
    }
  }
  if (!isPortableIdentifier(options.verifierId)) {
    throw new TypeError('verifierId must be a safe non-empty identifier');
  }
  if (!isPortableIdentifier(options.subject)) {
    throw new TypeError('subject must be a safe non-empty relative identifier');
  }
  if (options.executionId !== undefined && !isPortableIdentifier(options.executionId)) {
    throw new TypeError('executionId must be a safe non-empty identifier when provided');
  }
  if (options.exitCode !== undefined && !Number.isInteger(options.exitCode)) {
    throw new TypeError('exitCode must be an integer when provided');
  }
  if (options.timedOut !== undefined && typeof options.timedOut !== 'boolean') {
    throw new TypeError('timedOut must be boolean when provided');
  }
  if (options.signal !== undefined && options.signal !== null
    && (typeof options.signal !== 'string' || !isPortableIdentifier(options.signal))) {
    throw new TypeError('signal must be a safe non-empty identifier or null');
  }
  if (options.snapshotHash !== undefined && !isSha256(options.snapshotHash)) {
    throw new TypeError('snapshotHash must be a sha256 hash when provided');
  }
  if (options.fileHashes !== undefined) {
    const errors = validateFileHashes(options.fileHashes);
    if (errors.length > 0) throw new TypeError(errors.join('; '));
  }
  if (options.persistenceAttestation !== undefined) {
    const errors = validatePersistenceAttestation(options.persistenceAttestation, options, { verifySignature: true });
    if (errors.length > 0) throw new TypeError(errors.join('; '));
  }
  for (const field of ['startedAt', 'endedAt']) {
    if (options[field] !== undefined && !isStrictUtcTimestamp(options[field])) {
      throw new TypeError(`${field} must be a strict UTC ISO-8601 timestamp when provided`);
    }
  }
  if (options.startedAt && options.endedAt && Date.parse(options.endedAt) < Date.parse(options.startedAt)) {
    throw new TypeError('endedAt must not be earlier than startedAt');
  }
}

function createVerificationReceipt(options = {}) {
  assertCreateOptions(options);
  const receipt = {
    verifierId: options.verifierId,
    subject: options.subject,
    ...(options.executionId ? { executionId: options.executionId } : {}),
    exitCode: options.exitCode === undefined ? null : options.exitCode,
    timedOut: options.timedOut === true,
    signal: options.signal || null,
    ...(options.snapshotHash ? { snapshotHash: options.snapshotHash } : {}),
    ...(options.fileHashes ? { fileHashes: { ...options.fileHashes } } : {}),
    ...(options.persistenceAttestation ? { persistenceAttestation: { ...options.persistenceAttestation } } : {}),
    ...(options.startedAt ? { startedAt: options.startedAt } : {}),
    ...(options.endedAt ? { endedAt: options.endedAt } : {}),
  };
  const outcome = deriveVerificationOutcome(receipt, { verifySignature: true });

  return { ...receipt, ...outcome };
}

function validateVerificationReceipt(receipt, options = {}) {
  if (!isPlainObject(receipt)) {
    return { valid: false, errors: ['receipt must be an object'] };
  }

  const errors = [];
  for (const key of Object.keys(receipt)) {
    if (FORBIDDEN_RECEIPT_FIELDS.includes(key)) {
      errors.push(`${key} is not allowed in a durable verification receipt`);
    } else if (!RECEIPT_FIELDS.has(key)) {
      errors.push(`${key} is not allowed in a durable verification receipt`);
    }
  }

  if (!isPortableIdentifier(receipt.verifierId)) {
    errors.push('verifierId must be a safe non-empty identifier');
  }
  if (!isPortableIdentifier(receipt.subject)) {
    errors.push('subject must be a safe non-empty relative identifier');
  }
  if (receipt.executionId !== undefined && !isPortableIdentifier(receipt.executionId)) {
    errors.push('executionId must be a safe non-empty identifier when provided');
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
  if (receipt.signal !== null && !isPortableIdentifier(receipt.signal)) {
    errors.push('signal must be a safe non-empty identifier or null');
  }
  if (receipt.snapshotHash !== undefined && !isSha256(receipt.snapshotHash)) {
    errors.push('snapshotHash must be a sha256 hash');
  }
  if (receipt.fileHashes !== undefined) errors.push(...validateFileHashes(receipt.fileHashes));
  if (receipt.persistenceAttestation !== undefined) {
    errors.push(...validatePersistenceAttestation(receipt.persistenceAttestation, receipt, options));
  }
  for (const field of ['startedAt', 'endedAt']) {
    if (receipt[field] !== undefined && !isStrictUtcTimestamp(receipt[field])) {
      errors.push(`${field} must be a strict UTC ISO-8601 timestamp`);
    }
  }
  if (isStrictUtcTimestamp(receipt.startedAt) && isStrictUtcTimestamp(receipt.endedAt)
    && Date.parse(receipt.endedAt) < Date.parse(receipt.startedAt)) {
    errors.push('endedAt must not be earlier than startedAt');
  }

  const expected = deriveVerificationOutcome(receipt, options);
  if (receipt.state !== expected.state) {
    errors.push(`state must be ${expected.state} for this execution outcome`);
  }
  if (receipt.reason !== expected.reason) {
    errors.push(`reason must be ${expected.reason} for this execution outcome`);
  }

  return { valid: errors.length === 0, errors };
}

function assertValidVerificationReceipt(receipt) {
  const result = validateVerificationReceipt(receipt, { verifySignature: true });
  if (!result.valid) {
    throw new Error(`Invalid verification receipt: ${result.errors.join('; ')}`);
  }
  return receipt;
}

module.exports = {
  EVIDENCE_STATES,
  FORBIDDEN_RECEIPT_FIELDS,
  assertValidVerificationReceipt,
  createPersistenceAttestation,
  createVerificationReceipt,
  deriveVerificationOutcome,
  hasDurableArtifact,
  isPortableIdentifier,
  isStrictUtcTimestamp,
  validateVerificationReceipt,
};
