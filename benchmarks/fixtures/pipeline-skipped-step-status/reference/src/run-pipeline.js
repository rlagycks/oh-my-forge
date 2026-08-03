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
  let halted = false;

  for (const step of steps) {
    if (halted) {
      results.push({ name: step.name, status: 'not_run', reason: 'a previous step failed' });
      continue;
    }

    const enabled = typeof step.precondition === 'function' ? await step.precondition(context) : true;

    if (!enabled) {
      results.push({ name: step.name, status: 'skipped', reason: 'precondition not met' });
      continue;
    }

    try {
      await step.run(context);
      results.push({ name: step.name, status: 'completed' });
    } catch (error) {
      results.push({ name: step.name, status: 'failed', reason: error.message });
      halted = true;
    }
  }

  const isRequired = index => steps[index].required === true;

  const failed = results.some(result => result.status === 'failed');
  // A required step that never ran means the pipeline did not do its work, so
  // the run must not be reported as a success.
  const incomplete = results.some(
    (result, index) => isRequired(index) && (result.status === 'skipped' || result.status === 'not_run')
  );

  const status = failed ? 'failed' : incomplete ? 'incomplete' : 'success';
  return { status, steps: results };
}

module.exports = { runPipeline };
