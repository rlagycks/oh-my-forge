'use strict';

/**
 * Handle returned by on() and once(); calling it removes the listener.
 */
function createSubscription(remove) {
  if (typeof remove !== 'function') throw new TypeError('remove must be a function');

  return function unsubscribe() {
    remove();
  };
}

module.exports = { createSubscription };
