'use strict';

/**
 * Money helpers. All amounts are integer cents unless stated otherwise.
 */

/**
 * Round a fractional cent amount to a whole cent using banker's rounding
 * (round half to even).
 *
 * Half-to-even keeps long runs of tax lines from drifting upward, which is why
 * the finance team requires it.
 */
function roundCents(value) {
  if (!Number.isFinite(value)) throw new TypeError('value must be a finite number');

  const floor = Math.floor(value);
  const fraction = value - floor;

  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  // Exactly half: pick the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Tax on a line, in cents.
 */
function taxFor(amountCents, rate) {
  if (!Number.isInteger(amountCents)) throw new TypeError('amountCents must be an integer');
  if (!Number.isFinite(rate)) throw new TypeError('rate must be a finite number');
  return roundCents(amountCents * rate);
}

/**
 * Total of an invoice, in cents.
 */
function totalFor(lines, rate) {
  if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
  const subtotal = lines.reduce((sum, line) => sum + line, 0);
  // Same convention as taxFor, so a total always agrees with its tax lines.
  return subtotal + taxFor(subtotal, rate);
}

/**
 * Split `amountCents` across `weights` so the parts sum exactly to the input.
 *
 * Largest-remainder method: floor every share, then hand the leftover cents to
 * the largest fractional remainders, breaking ties by index so the result is
 * deterministic.
 */
function allocate(amountCents, weights) {
  if (!Number.isInteger(amountCents)) throw new TypeError('amountCents must be an integer');
  if (!Array.isArray(weights) || weights.length === 0) throw new TypeError('weights must be a non-empty array');

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight === 0) throw new RangeError('weights must not sum to zero');

  const exact = weights.map(weight => (amountCents * weight) / totalWeight);
  const base = exact.map(share => Math.floor(share));
  const distributed = base.reduce((sum, share) => sum + share, 0);

  // Leftover is negative when amountCents is negative, so step by its sign.
  const leftover = amountCents - distributed;
  const order = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  return order
    .slice(0, Math.abs(leftover))
    .reduce(
      (result, { index }) => result.map((value, at) => (at === index ? value + Math.sign(leftover) : value)),
      base
    );
}

module.exports = { allocate, roundCents, taxFor, totalFor };
