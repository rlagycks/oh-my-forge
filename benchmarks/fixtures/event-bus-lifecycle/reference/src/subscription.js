'use strict';

/**
 * Handle returned by on() and once(); calling it removes the listener.
 *
 * Idempotent: a second call is a no-op, so it can never remove a later
 * listener that reused the same slot.
 */
function createSubscription(remove) {
  if (typeof remove !== 'function') throw new TypeError('remove must be a function');

  let active = true;
  return function unsubscribe() {
    if (!active) return;
    active = false;
    remove();
  };
}

module.exports = { createSubscription };
