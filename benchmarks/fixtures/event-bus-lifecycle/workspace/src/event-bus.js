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
    const entry = { handler, once };
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
      const list = listenersFor(event);
      for (const entry of list) {
        entry.handler(payload);
        if (entry.once) remove(event, entry);
      }
      return this;
    },

    listenerCount(event) {
      return listenersFor(event).length;
    },
  };
}

module.exports = { createEventBus };
