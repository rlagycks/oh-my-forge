'use strict';

const { createSubscription } = require('./subscription.js');

/**
 * Minimal synchronous event bus.
 */
function createEventBus() {
  const listeners = new Map();

  function listenersFor(event) {
    if (!listeners.has(event)) listeners.set(event, []);
    return listeners.get(event);
  }

  function remove(event, entry) {
    const list = listenersFor(event);
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
  }

  function add(event, handler, once) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const entry = { handler, once, fired: false };
    listenersFor(event).push(entry);
    return createSubscription(() => remove(event, entry));
  }

  return {
    on(event, handler) {
      return add(event, handler, false);
    },

    once(event, handler) {
      return add(event, handler, true);
    },

    off(event, handler) {
      const list = listenersFor(event);
      const index = list.findIndex(entry => entry.handler === handler);
      if (index !== -1) list.splice(index, 1);
      return this;
    },

    emit(event, payload) {
      // Snapshot before dispatch: handlers may subscribe or unsubscribe, and a
      // live list would skip, repeat, or newly include listeners mid-iteration.
      const snapshot = [...listenersFor(event)];
      let firstError = null;

      for (const entry of snapshot) {
        // A once entry may already have fired via a re-entrant emit.
        if (entry.once) {
          if (entry.fired) continue;
          // Mark and detach before invoking so re-entry cannot run it again.
          entry.fired = true;
          remove(event, entry);
        }
        try {
          entry.handler(payload);
        } catch (error) {
          if (firstError === null) firstError = error;
        }
      }

      if (firstError !== null) throw firstError;
      return this;
    },

    listenerCount(event) {
      return listenersFor(event).length;
    },
  };
}

module.exports = { createEventBus };
