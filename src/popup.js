/*
 * Popup controller.
 *
 * There is no Save button: every change writes straight to storage (debounced,
 * and serialised by the storage adapter so the last edit wins). The content
 * script picks changes up through chrome.storage.onChanged, so YouTube updates
 * while the popup is still open.
 */
(function () {
  'use strict';

  var Engine = globalThis.TitleEngine;
  var Store = globalThis.TitleStore;

  var SAVE_DEBOUNCE_MS = 180;
  var UNDO_WINDOW_MS = 6000;

  var el = {
    globalEnabled: document.getElementById('global-enabled'),
    globalState: document.getElementById('global-state'),
    pausedNote: document.getElementById('paused-note'),
    count: document.getElementById('rule-count'),
    empty: document.getElementById('empty-state'),
    list: document.getElementById('rules-list'),
    addRule: document.getElementById('add-rule'),
    status: document.getElementById('status'),
    error: document.getElementById('error'),
    undoBar: document.getElementById('undo-bar'),
    undoText: document.getElementById('undo-text'),
    undoBtn: document.getElementById('undo-btn'),
    template: document.getElementById('rule-template')
  };

  var config = Store.defaults();
  var openRuleId = null; // one card expanded at a time
  var cards = new Map(); // rule id -> <li>
  var saveTimer = null;
  var undo = null; // { rule, index, timer }
  var statusTimer = null;
  var applyingRemote = false;

  // --- saving --------------------------------------------------------------

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return Store.save(config).then(
      function (result) {
        clearError();
        if (result.written) showStatus('Saved.');
        return result;
      },
      function (err) {
        // Never imply a save that didn't happen.
        showError('Couldn’t save: ' + (err && err.message ? err.message : 'storage error') + '. Your last change may be lost.');
        throw err;
      }
    );
  }

  function queueSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      flushSave().catch(function () {});
    }, SAVE_DEBOUNCE_MS);
  }

  function showStatus(text) {
    el.status.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      el.status.textContent = '';
    }, 1600);
  }

  function showError(text) {
    el.error.textContent = text;
    el.error.hidden = false;
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = '';
  }

  // --- rendering -----------------------------------------------------------

  function enabledValidCount() {
    return config.rules.filter(function (r) {
      return r.enabled && Engine.isRuleValid(r);
    }).length;
  }

  function renderSummary() {
    var total = config.rules.length;
    var active = enabledValidCount();

    el.globalEnabled.checked = config.enabled;
    el.globalState.textContent = config.enabled ? 'On' : 'Off';
    el.pausedNote.hidden = config.enabled;

    el.empty.hidden = total > 0;
    el.count.textContent = total === 0 ? '' : active + ' of ' + total + ' active';
    el.count.hidden = total === 0;
  }

  /** Full structural render: used on load, add, delete and reorder. */
  function renderList() {
    cards.clear();
    el.list.textContent = '';

    config.rules.forEach(function (rule, index) {
      var card = buildCard(rule, index);
      cards.set(rule.id, card);
      el.list.appendChild(card);
    });

    renderSummary();
  }

  function buildCard(rule, index) {
    var card = el.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = rule.id;

    var bodyId = 'rule-body-' + rule.id;
    var body = card.querySelector('.card-body');
    var disclosure = card.querySelector('.disclosure');
    body.id = bodyId;
    disclosure.setAttribute('aria-controls', bodyId);

    var q = function (sel) { return card.querySelector(sel); };

    // Group the radios per card so they don't fight across cards.
    card.querySelectorAll('.action').forEach(function (radio) {
      radio.name = 'action-' + rule.id;
    });

    // Tie each visible label to its control. Ids have to be minted per card,
    // since the template is cloned once per rule and ids must stay unique.
    card.querySelectorAll('.field').forEach(function (field, i) {
      var label = field.querySelector('.field-label');
      if (!label) return;
      var control = field.querySelector('.input');

      if (control) {
        control.id = 'f-' + rule.id + '-' + i;
        label.setAttribute('for', control.id);
        return;
      }

      // The action field is a radio group rather than a single control.
      var group = field.querySelector('[role="radiogroup"]');
      if (group) {
        label.id = 'l-' + rule.id + '-' + i;
        label.removeAttribute('for');
        group.setAttribute('aria-labelledby', label.id);
      }
    });

    q('.match').value = rule.match;
    q('.find').value = rule.find;
    q('.replacement').value = rule.replacement;
    q('.case-sensitive').checked = rule.caseSensitive;
    card.querySelectorAll('.action').forEach(function (radio) {
      radio.checked = radio.value === rule.action;
    });

    var toggle = q('.rule-enabled');
    toggle.checked = rule.enabled;

    // --- wiring ---
    disclosure.addEventListener('click', function () {
      setOpen(rule.id, openRuleId !== rule.id);
    });

    toggle.addEventListener('change', function () {
      mutate(rule.id, function (r) { r.enabled = toggle.checked; });
    });

    q('.match').addEventListener('change', function (event) {
      mutate(rule.id, function (r) { r.match = event.target.value; });
    });

    q('.find').addEventListener('input', function (event) {
      mutate(rule.id, function (r) { r.find = event.target.value; });
    });

    q('.replacement').addEventListener('input', function (event) {
      mutate(rule.id, function (r) { r.replacement = event.target.value; });
    });

    q('.case-sensitive').addEventListener('change', function (event) {
      mutate(rule.id, function (r) { r.caseSensitive = event.target.checked; });
    });

    card.querySelectorAll('.action').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        mutate(rule.id, function (r) { r.action = radio.value; });
        if (radio.value === 'replace') {
          var input = card.querySelector('.replacement');
          // Expanding the field and focusing it is the next thing they need.
          requestAnimationFrame(function () { input.focus(); });
        }
      });
    });

    q('.move-up').addEventListener('click', function () { moveRule(rule.id, -1); });
    q('.move-down').addEventListener('click', function () { moveRule(rule.id, 1); });
    q('.delete-rule').addEventListener('click', function () { deleteRule(rule.id); });

    refreshCard(card, rule, index);
    return card;
  }

  /** Lightweight update: labels, flags, validity, disabled states. Keeps focus. */
  function refreshCard(card, rule, index) {
    var q = function (sel) { return card.querySelector(sel); };
    var valid = Engine.isRuleValid(rule);
    var reason = Engine.ruleInvalidReason(rule);
    var isOpen = openRuleId === rule.id;

    q('.desc').textContent = Engine.describeRule(rule);

    card.classList.toggle('is-open', isOpen);
    card.classList.toggle('is-off', !rule.enabled);
    q('.disclosure').setAttribute('aria-expanded', String(isOpen));
    q('.card-body').hidden = !isOpen;

    card.querySelector('[data-flag="case"]').hidden = !rule.caseSensitive;

    // Only call it out as a problem once they've started filling it in, so a
    // brand-new empty card doesn't shout at them.
    var touched = rule.find !== '' || rule.replacement !== '' || rule.enabled;
    var flagInvalid = !valid && touched;
    card.querySelector('[data-flag="invalid"]').hidden = !flagInvalid;

    var hint = q('.invalid-hint');
    if (!valid && reason) {
      hint.textContent = reason;
      hint.hidden = !isOpen;
    } else {
      hint.hidden = true;
    }

    q('.replacement-field').hidden = rule.action !== 'replace';

    // An unusable rule can't be switched on — but a rule that's already on and
    // has gone temporarily invalid stays switchable so it can be turned off.
    var toggle = q('.rule-enabled');
    toggle.checked = rule.enabled;
    toggle.disabled = !valid && !rule.enabled;
    toggle.setAttribute(
      'aria-label',
      (rule.enabled ? 'Turn off rule: ' : 'Turn on rule: ') + Engine.describeRule(rule)
    );

    q('.move-up').disabled = index === 0;
    q('.move-down').disabled = index === config.rules.length - 1;

    var label = Engine.describeRule(rule);
    q('.move-up').setAttribute('aria-label', 'Move up: ' + label);
    q('.move-down').setAttribute('aria-label', 'Move down: ' + label);
    q('.delete-rule').setAttribute('aria-label', 'Delete rule: ' + label);
  }

  function refreshAll() {
    config.rules.forEach(function (rule, index) {
      var card = cards.get(rule.id);
      if (card) refreshCard(card, rule, index);
    });
    renderSummary();
  }

  function setOpen(id, shouldOpen) {
    openRuleId = shouldOpen ? id : null;
    refreshAll();
    if (shouldOpen) {
      var card = cards.get(id);
      if (card) {
        var input = card.querySelector('.find');
        if (input) input.focus();
        card.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  // --- mutations -----------------------------------------------------------

  function findRule(id) {
    return config.rules.find(function (r) { return r.id === id; }) || null;
  }

  function mutate(id, change) {
    var rule = findRule(id);
    if (!rule) return;
    change(rule);
    refreshAll();
    queueSave();
  }

  function addRule() {
    var rule = Store.newRule();
    config.rules.push(rule);
    openRuleId = rule.id;
    renderList();
    var card = cards.get(rule.id);
    if (card) {
      card.scrollIntoView({ block: 'nearest' });
      card.querySelector('.find').focus();
    }
    queueSave();
  }

  function moveRule(id, delta) {
    var from = config.rules.findIndex(function (r) { return r.id === id; });
    var to = from + delta;
    if (from === -1 || to < 0 || to >= config.rules.length) return;

    var moved = config.rules.splice(from, 1)[0];
    config.rules.splice(to, 0, moved);
    renderList();

    // Keep the keyboard on the control they just pressed.
    var card = cards.get(id);
    if (card) {
      var btn = card.querySelector(delta < 0 ? '.move-up' : '.move-down');
      if (btn && !btn.disabled) btn.focus();
      else card.querySelector('.disclosure').focus();
      card.scrollIntoView({ block: 'nearest' });
    }
    queueSave();
  }

  function deleteRule(id) {
    var index = config.rules.findIndex(function (r) { return r.id === id; });
    if (index === -1) return;

    var removed = config.rules.splice(index, 1)[0];
    if (openRuleId === id) openRuleId = null;
    renderList();
    queueSave();
    offerUndo(removed, index);
    el.addRule.focus();
  }

  function offerUndo(rule, index) {
    clearUndoTimer();
    undo = { rule: rule, index: index, timer: null };
    el.undoText.textContent = 'Deleted “' + Engine.describeRule(rule) + '”.';
    el.undoBar.hidden = false;
    undo.timer = setTimeout(dismissUndo, UNDO_WINDOW_MS);
  }

  function clearUndoTimer() {
    if (undo && undo.timer) clearTimeout(undo.timer);
  }

  function dismissUndo() {
    clearUndoTimer();
    undo = null;
    el.undoBar.hidden = true;
  }

  function performUndo() {
    if (!undo) return;
    var rule = undo.rule;
    var at = Math.min(undo.index, config.rules.length);
    config.rules.splice(at, 0, rule);
    dismissUndo();
    openRuleId = rule.id;
    renderList();
    queueSave();
    var card = cards.get(rule.id);
    if (card) card.querySelector('.disclosure').focus();
  }

  // --- global toggle -------------------------------------------------------

  el.globalEnabled.addEventListener('change', function () {
    config.enabled = el.globalEnabled.checked;
    refreshAll();
    queueSave();
  });

  el.addRule.addEventListener('click', addRule);
  el.undoBtn.addEventListener('click', performUndo);

  // Popup closing is a normal way to finish editing, so make sure the last
  // keystroke is written rather than lost with the debounce timer.
  window.addEventListener('pagehide', function () {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      Store.save(config).catch(function () {});
    }
  });

  // --- startup -------------------------------------------------------------

  Store.load().then(
    function (loaded) {
      config = loaded;
      renderList();
      if (config.rules.length === 0) el.addRule.focus();
    },
    function (err) {
      showError('Couldn’t read your saved rules: ' + (err && err.message ? err.message : 'storage error'));
      renderList();
    }
  );

  // Storage change events also fire in the context that wrote them, so a plain
  // re-render here would blow away focus on every keystroke. Only adopt a
  // change that genuinely differs from what we already hold.
  Store.subscribe(function (next) {
    if (saveTimer || applyingRemote) return;
    if (JSON.stringify(next) === JSON.stringify(config)) return;

    applyingRemote = true;
    try {
      config = next;
      renderList();
    } finally {
      applyingRemote = false;
    }
  });
})();
