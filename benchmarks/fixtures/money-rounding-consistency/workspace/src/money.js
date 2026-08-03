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
  // Uses a different rounding rule from taxFor, so totals can disagree with
  // the sum of the tax lines.
  return subtotal + Math.round(subtotal * rate);
}

/**
 * Split `amountCents` across `weights`.
 */
function allocate(amountCents, weights) {
  if (!Number.isInteger(amountCents)) throw new TypeError('amountCents must be an integer');
  if (!Array.isArray(weights) || weights.length === 0) throw new TypeError('weights must be a non-empty array');

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  // Rounds each share independently, so the parts need not sum to the input.
  return weights.map(weight => Math.round((amountCents * weight) / totalWeight));
}

module.exports = { allocate, roundCents, taxFor, totalFor };
