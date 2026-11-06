/*
 * Minimal chrome.* stand-in so the popup and content script can be exercised
 * on a plain web page during development. Not shipped with the extension.
 */
(function () {
  'use strict';
  var KEY = '__ytc_dev_store';
  var listeners = [];
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  window.chrome = {
    runtime: { lastError: null, id: 'dev-harness' },
    storage: {
      local: {
        get: function (key, cb) {
          setTimeout(function () {
            var out = {};
            if (typeof key === 'string') { if (key in store) out[key] = store[key]; }
            else if (Array.isArray(key)) key.forEach(function (k) { if (k in store) out[k] = store[k]; });
            else out = JSON.parse(JSON.stringify(store));
            cb(out);
          }, 0);
        },
        set: function (obj, cb) {
          setTimeout(function () {
            var changes = {};
            Object.keys(obj).forEach(function (k) {
              changes[k] = { oldValue: store[k], newValue: obj[k] };
              store[k] = obj[k];
            });
            persist();
            if (cb) cb();
            // Real Chrome notifies every context, including the writer.
            listeners.forEach(function (fn) { try { fn(changes, 'local'); } catch (e) {} });
          }, 0);
        },
        clear: function (cb) { store = {}; persist(); if (cb) cb(); }
      },
      onChanged: {
        addListener: function (fn) { listeners.push(fn); },
        removeListener: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
      }
    }
  };

  // Let the harness page drive storage directly for test setup.
  window.__ytcDev = {
    reset: function () { store = {}; persist(); },
    read: function () { return JSON.parse(JSON.stringify(store)); },
    write: function (config) {
      return new Promise(function (resolve) {
        window.chrome.storage.local.set({ config: config }, resolve);
      });
    }
  };
})();
