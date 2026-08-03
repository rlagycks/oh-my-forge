'use strict';

/**
 * Did the provider actually run the task?
 *
 * The CLI exits 0 and returns well-formed JSON even when the API call failed:
 * `is_error: true`, `terminal_reason: "api_error"`, zero tokens, zero cost, and
 * a couple of seconds of wall time. Nothing throws.
 *
 * The first pilot was destroyed by exactly this. A session limit was reached at
 * repetition 4, and the remaining 210 episodes returned api_error in ~2 seconds
 * each. The adapter parsed them as ordinary runs, verification then failed
 * because the workspace was untouched, and 210 provider outages were recorded
 * as agent task failures — dragging the measured success rate from ~60% to 18%
 * across BOTH conditions.
 *
 * So a provider result has to be interrogated before it is scored. An outage is
 * infrastructure, not evidence: the runner drops the whole pair rather than
 * penalising whichever condition happened to be running.
 */

/** Terminal reasons that mean the provider never did the work. */
const PROVIDER_FAILURE_REASONS = new Set([
  'api_error',
  'budget_exhausted',
  'refusal',
  'max_turns',
]);

/**
 * @param {object} parsed  Parsed `claude --output-format json` payload.
 * @returns {{ok: boolean, reason: string|null}}
 */
function classifyProviderResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'provider returned no parseable result' };
  }

  if (parsed.is_error === true) {
    return { ok: false, reason: `provider reported is_error (terminal_reason: ${parsed.terminal_reason || 'unknown'})` };
  }

  if (typeof parsed.terminal_reason === 'string' && PROVIDER_FAILURE_REASONS.has(parsed.terminal_reason)) {
    return { ok: false, reason: `provider stopped early: ${parsed.terminal_reason}` };
  }

  const usage = parsed.usage || {};
  const context = (Number(usage.input_tokens) || 0)
    + (Number(usage.cache_read_input_tokens) || 0)
    + (Number(usage.cache_creation_input_tokens) || 0);

  // A real episode always sends a system prompt and a task prompt. Zero context
  // means the request never reached the model, whatever the other fields say.
  if (context === 0) {
    return { ok: false, reason: 'provider consumed zero context tokens; the request never reached the model' };
  }

  if ((Number(usage.output_tokens) || 0) === 0) {
    return { ok: false, reason: 'provider produced zero output tokens' };
  }

  return { ok: true, reason: null };
}

module.exports = { PROVIDER_FAILURE_REASONS, classifyProviderResult };
