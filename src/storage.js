/*
 * Chrome storage adapter.
 *
 * Owns the on-disk shape of the config, normalises whatever comes back out of
 * storage, and serialises writes so a burst of keystrokes can't land out of
 * order. Used by both the popup and the content script.
 */
(function (global) {
  'use strict';

  var KEY = 'config';
  var SCHEMA_VERSION = 1;

  /* Hard limits on what storage will hold. The popup enforces them too, but
     they live here so that anything else that writes a config — a future
     import, a hand-edited value — is held to the same bounds. */
  var MAX_RULES = 50;
  var MAX_FIELD_LENGTH = 200;

  function defaults() {
    return { schemaVersion: SCHEMA_VERSION, enabled: true, rules: [] };
  }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function newRule() {
    return {
      id: newId(),
      enabled: false, // new rules stay off until the user switches them on
      match: 'contains',
      find: '',
      action: 'remove',
      replacement: '',
      caseSensitive: false
    };
  }

  var MATCHES = ['contains', 'startsWith', 'endsWith'];
  var ACTIONS = ['remove', 'replace'];

  function str(value) {
    return typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : '';
  }

  /**
   * Coerce anything we read into a shape the rest of the code can trust.
   * Storage can hold data from an older build, a partial write, or a user
   * poking at it — none of that should be able to crash the popup.
   */
  function normalizeRule(raw) {
    var rule = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof rule.id === 'string' && rule.id ? rule.id : newId(),
      enabled: rule.enabled === true,
      match: MATCHES.indexOf(rule.match) !== -1 ? rule.match : 'contains',
      find: str(rule.find),
      action: ACTIONS.indexOf(rule.action) !== -1 ? rule.action : 'remove',
      replacement: str(rule.replacement),
      caseSensitive: rule.caseSensitive === true
    };
  }

  function normalize(raw) {
    var config = raw && typeof raw === 'object' ? raw : {};
    var rules = Array.isArray(config.rules) ? config.rules.slice(0, MAX_RULES).map(normalizeRule) : [];

    // Duplicate ids would make the popup edit the wrong card.
    var seen = Object.create(null);
    rules.forEach(function (rule) {
      if (seen[rule.id]) rule.id = newId();
      seen[rule.id] = true;
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: config.enabled !== false, // defaults to on, including on first install
      rules: rules
    };
  }

  function clone(config) {
    return JSON.parse(JSON.stringify(config));
  }

  function load() {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local.get(KEY, function (result) {
          var err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || 'Could not read saved settings.'));
            return;
          }
          resolve(normalize(result && result[KEY] ? result[KEY] : defaults()));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // --- serialised writes ---------------------------------------------------
  // Every save takes a ticket. When its turn comes it bails out if a newer
  // save is already queued, so rapid edits collapse to "latest wins" and an
  // older snapshot can never overwrite a newer one.
  var ticketCounter = 0;
  var chain = Promise.resolve();

  function save(config) {
    var ticket = ++ticketCounter;
    var snapshot = clone(normalize(config));

    var pending = chain.then(function () {
      if (ticket !== ticketCounter) return { written: false, superseded: true };
      return new Promise(function (resolve, reject) {
        try {
          var payload = {};
          payload[KEY] = snapshot;
          chrome.storage.local.set(payload, function () {
            var err = chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message || 'Could not save settings.'));
              return;
            }
            resolve({ written: true, superseded: false });
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    // Keep the chain usable after a rejection, but still hand the error to the
    // caller so the popup can say so out loud instead of implying a save.
    chain = pending.then(
      function () {},
      function () {}
    );

    return pending;
  }

  /** Fires whenever the config changes, including from another tab or popup. */
  function subscribe(callback) {
    function listener(changes, area) {
      if (area !== 'local' || !changes[KEY]) return;
      callback(normalize(changes[KEY].newValue || defaults()));
    }
    chrome.storage.onChanged.addListener(listener);
    return function unsubscribe() {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  global.TitleStore = {
    KEY: KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_RULES: MAX_RULES,
    MAX_FIELD_LENGTH: MAX_FIELD_LENGTH,
    defaults: defaults,
    newRule: newRule,
    newId: newId,
    normalize: normalize,
    load: load,
    save: save,
    subscribe: subscribe
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
