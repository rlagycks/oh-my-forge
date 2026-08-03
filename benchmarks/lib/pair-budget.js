'use strict';

/**
 * Budget reservation for paired episodes.
 *
 * The runner tracks one run-level budget and hands the adapter whatever is
 * left before each individual condition. That is not enough to keep a pair
 * honest: if the first member spends near the cap, the second is left with
 * less, and a pair whose two halves ran on different budgets is still marked
 * complete. The generation budget is not part of the comparison fingerprint,
 * so `--require-comparable` does not catch it.
 *
 * Clamping the second member is also not a fix, because with
 * `--require-comparable` any adapter error aborts the whole run
 * (paired-benchmark-runner.js maps it to COMPARISON_CONFIG_MISMATCH) — after
 * the first half has already been paid for.
 *
 * So reserve the full cost of BOTH members before the first one starts. Either
 * the pair can be funded end to end, or nothing is spent on it at all.
 */

const MEMBERS_PER_PAIR = 2;

function pairKey(taskId, repetition) {
  return `${taskId}#${repetition}`;
}

/**
 * @param {number} perEpisodeBudgetUsd  Budget every single episode must get.
 * @returns {{reserve: function, isFirstMember: function}}
 */
function createPairBudgetGuard(perEpisodeBudgetUsd) {
  if (typeof perEpisodeBudgetUsd !== 'number' || !Number.isFinite(perEpisodeBudgetUsd) || perEpisodeBudgetUsd <= 0) {
    throw new TypeError('perEpisodeBudgetUsd must be a positive number');
  }

  const started = new Set();

  return {
    isFirstMember(taskId, repetition) {
      return !started.has(pairKey(taskId, repetition));
    },

    /**
     * Claim funding for one condition of a pair.
     *
     * @returns {{ok: boolean, required: number, budget: number, reason?: string}}
     */
    reserve({ taskId, repetition, remainingCostUsd }) {
      const key = pairKey(taskId, repetition);
      const first = !started.has(key);
      // The first member must cover the whole pair; the second is already
      // funded by that reservation.
      const required = first ? perEpisodeBudgetUsd * MEMBERS_PER_PAIR : perEpisodeBudgetUsd;

      const unlimited = remainingCostUsd === null
        || remainingCostUsd === undefined
        || !Number.isFinite(remainingCostUsd);

      if (!unlimited && remainingCostUsd < required) {
        return {
          ok: false,
          required,
          budget: perEpisodeBudgetUsd,
          reason: first
            ? `remaining run budget $${remainingCostUsd.toFixed(4)} cannot fund both members of the pair `
              + `($${required.toFixed(4)} needed); stopping before any of it is spent`
            : `remaining run budget $${remainingCostUsd.toFixed(4)} fell below the per-episode budget `
              + `$${required.toFixed(4)} mid-pair`,
        };
      }

      started.add(key);
      return { ok: true, required, budget: perEpisodeBudgetUsd };
    },
  };
}

module.exports = { MEMBERS_PER_PAIR, createPairBudgetGuard, pairKey };
