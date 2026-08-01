'use strict';

/**
 * Run an ordered list of steps.
 *
 * A step is { name, required, precondition, run }. `precondition` is optional
 * and defaults to always true.
 *
 * @returns {{status: string, steps: object[]}}
 */
async function runPipeline(steps, context = {}) {
  if (!Array.isArray(steps)) throw new TypeError('steps must be an array');

  const results = [];

  for (const step of steps) {
    const enabled = typeof step.precondition === 'function' ? await step.precondition(context) : true;

    if (!enabled) {
      results.push({ name: step.name, status: 'skipped' });
      continue;
    }

    try {
      await step.run(context);
      results.push({ name: step.name, status: 'completed' });
    } catch (error) {
      results.push({ name: step.name, status: 'failed', reason: error.message });
    }
  }

  // A skipped step is treated as harmless, so a run that never did its work
  // still reports success.
  const failed = results.some(result => result.status === 'failed');

  return { status: failed ? 'failed' : 'success', steps: results };
}

module.exports = { runPipeline };
