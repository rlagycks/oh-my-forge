'use strict';

const COMPLETION_REPORT_FIELDS = [
  'RESULT',
  'FILES CHANGED',
  'TESTS',
  'EVIDENCE',
  'FALSE NORMAL CHECKS',
  'FALSE NORMAL SIGNALS',
  'OPEN RISKS',
  'NEXT ACTION',
  'SUMMARY',
];
const FALSE_NORMAL_DETECTOR_RULE = 'RESULT:DONE requires explicit TESTS, EVIDENCE, FALSE NORMAL CHECKS, FALSE NORMAL SIGNALS: none, and NEXT ACTION.';

function uniqueStrings(values = []) {
  return [...new Set((values || [])
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))];
}

function normalizeChecklist(values, fallback = []) {
  const normalized = uniqueStrings(values);
  return normalized.length > 0 ? normalized : uniqueStrings(fallback);
}

function splitChecklist(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^none$/i.test(trimmed)) {
    return [];
  }

  return uniqueStrings(trimmed.split('|').map(part => part.trim()));
}

function splitFilesChanged(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^none$/i.test(trimmed)) {
    return [];
  }

  return uniqueStrings(trimmed.split(',').map(part => part.trim()));
}

function resultStateFor(result) {
  if (result === 'DONE') return 'COMPLETED';
  if (result === 'PARTIAL') return 'PARTIAL';
  return 'BLOCKED';
}

function parseCompletionReport(output) {
  const rawOutput = typeof output === 'string' ? output : '';
  const resultMatch = rawOutput.match(/^RESULT:\s*(DONE|BLOCKED|PARTIAL)\s*$/m);
  const filesMatch = rawOutput.match(/^FILES CHANGED:\s*(.*)$/m);
  const testsMatch = rawOutput.match(/^TESTS:\s*(PASS|FAIL|SKIPPED)\s*$/m);
  const evidenceMatch = rawOutput.match(/^EVIDENCE:\s*(.*)$/m);
  const falseNormalMatch = rawOutput.match(/^FALSE NORMAL CHECKS:\s*(.*)$/m);
  const falseNormalSignalsMatch = rawOutput.match(/^FALSE NORMAL SIGNALS:\s*(.*)$/m);
  const openRisksMatch = rawOutput.match(/^OPEN RISKS:\s*(.*)$/m);
  const nextActionMatch = rawOutput.match(/^NEXT ACTION:\s*(.*)$/m);
  const summaryMatch = rawOutput.match(/^SUMMARY:\s*(.*)$/m);

  return {
    rawOutput,
    result: resultMatch ? resultMatch[1] : '',
    resultMatch: Boolean(resultMatch),
    filesChanged: splitFilesChanged(filesMatch ? filesMatch[1] : ''),
    tests: testsMatch ? testsMatch[1] : 'SKIPPED',
    testsMatch: Boolean(testsMatch),
    evidence: splitChecklist(evidenceMatch ? evidenceMatch[1] : ''),
    falseNormalChecks: splitChecklist(falseNormalMatch ? falseNormalMatch[1] : ''),
    falseNormalSignals: splitChecklist(falseNormalSignalsMatch ? falseNormalSignalsMatch[1] : ''),
    falseNormalSignalsMatch: Boolean(falseNormalSignalsMatch),
    openRisks: splitChecklist(openRisksMatch ? openRisksMatch[1] : ''),
    nextAction: nextActionMatch ? nextActionMatch[1].trim() : '',
    summary: summaryMatch ? summaryMatch[1] : '',
  };
}

function detectFalseNormalCompletion(fields = {}) {
  if (fields.result !== 'DONE') {
    return [];
  }

  const signals = [];
  if (!fields.testsMatch) {
    signals.push('RESULT:DONE without explicit TESTS line.');
  } else if (fields.tests === 'FAIL') {
    signals.push('RESULT:DONE with TESTS: FAIL.');
  }

  if (fields.evidence.length === 0) {
    signals.push('RESULT:DONE without explicit EVIDENCE.');
  }

  if (fields.falseNormalChecks.length === 0) {
    signals.push('RESULT:DONE without explicit FALSE NORMAL CHECKS.');
  }

  if (!fields.falseNormalSignalsMatch) {
    signals.push('RESULT:DONE without explicit FALSE NORMAL SIGNALS line.');
  } else if (fields.falseNormalSignals.length > 0) {
    signals.push(`RESULT:DONE has unresolved FALSE NORMAL SIGNALS: ${fields.falseNormalSignals.join(' | ')}`);
  }

  if (!fields.nextAction) {
    signals.push('RESULT:DONE without explicit NEXT ACTION.');
  }

  if (
    fields.tests === 'PASS'
    && (fields.evidence.length === 0 || fields.falseNormalChecks.length === 0 || !fields.nextAction)
  ) {
    signals.push('TESTS: PASS alone is not sufficient completion evidence.');
  }

  return uniqueStrings(signals);
}

function parseCompletionResult(output, options = {}) {
  const fields = parseCompletionReport(output);
  const schemaVersion = options.schemaVersion || 'ecc.completion.result.v1';
  const detectorName = options.detectorName || 'False-normal detector';

  if (!fields.resultMatch) {
    return {
      schemaVersion,
      state: 'BLOCKED',
      valid: false,
      result: 'BLOCKED',
      filesChanged: [],
      tests: fields.tests,
      evidence: normalizeChecklist(fields.evidence, [
        options.missingResultEvidence || 'Completion output did not contain a RESULT line.',
      ]),
      falseNormalChecks: normalizeChecklist(fields.falseNormalChecks, [
        options.missingResultCheck || 'Rejected completion because the RESULT line was missing.',
      ]),
      falseNormalSignals: normalizeChecklist(fields.falseNormalSignals, [
        options.missingResultSignal || 'Missing RESULT made the output look like a handoff but not an executable result.',
      ]),
      openRisks: fields.openRisks,
      nextAction: fields.nextAction || options.missingResultNextAction || 'Inspect the blocked handoff output and re-run with a clearer contract.',
      summary: options.missingResultSummary || 'Completion output returned no RESULT line.',
      error: options.missingResultError || 'Completion output returned no RESULT line.',
      rawOutput: fields.rawOutput,
    };
  }

  const detectedSignals = detectFalseNormalCompletion(fields);
  if (detectedSignals.length > 0) {
    return {
      schemaVersion,
      state: 'BLOCKED',
      valid: false,
      result: 'BLOCKED',
      filesChanged: fields.filesChanged,
      tests: fields.tests,
      evidence: normalizeChecklist(fields.evidence, [
        options.falseNormalEvidence || `${detectorName} rejected RESULT:DONE because required proof was missing.`,
      ]),
      falseNormalChecks: normalizeChecklist(fields.falseNormalChecks, detectedSignals),
      falseNormalSignals: uniqueStrings([...fields.falseNormalSignals, ...detectedSignals]),
      openRisks: uniqueStrings([
        ...fields.openRisks,
        options.falseNormalOpenRisk || 'Rejected RESULT:DONE until false-normal signals are resolved.',
      ]),
      nextAction: fields.nextAction || options.falseNormalNextAction || 'Provide TESTS, EVIDENCE, FALSE NORMAL CHECKS, FALSE NORMAL SIGNALS, and NEXT ACTION, then rerun the completion parser.',
      summary: fields.summary || options.falseNormalSummary || `${detectorName} blocked completion.`,
      error: `${detectorName} blocked completion: ${detectedSignals.join('; ')}`,
      rawOutput: fields.rawOutput,
    };
  }

  const result = {
    schemaVersion,
    state: resultStateFor(fields.result),
    valid: true,
    result: fields.result,
    filesChanged: fields.filesChanged,
    tests: fields.tests,
    evidence: normalizeChecklist(fields.evidence, [
      `Observed result ${fields.result} with tests=${fields.tests}.`,
    ]),
    falseNormalChecks: normalizeChecklist(fields.falseNormalChecks, [
      'Checked the completion status against explicit result and test output.',
    ]),
    falseNormalSignals: fields.falseNormalSignals,
    openRisks: fields.openRisks,
    nextAction: fields.nextAction
      ? fields.nextAction
      : fields.result === 'DONE'
        ? 'Review the evidence and merge when the diff looks correct.'
        : 'Investigate remaining gaps and continue from the latest evidence.',
    summary: fields.summary || 'No summary provided.',
  };

  if (fields.rawOutput) {
    result.rawOutput = fields.rawOutput;
  }

  return result;
}

module.exports = {
  COMPLETION_REPORT_FIELDS,
  FALSE_NORMAL_DETECTOR_RULE,
  detectFalseNormalCompletion,
  parseCompletionReport,
  parseCompletionResult,
  resultStateFor,
  splitChecklist,
  splitFilesChanged,
};
