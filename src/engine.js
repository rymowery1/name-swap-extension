/*
 * Shared rules engine.
 *
 * Pure transformation logic: give it an original title plus a config, get a
 * transformed title back. Deliberately has NO dependency on chrome.* APIs so
 * it can be unit tested in Node and reused later for the Safari port.
 */
(function (global) {
  'use strict';

  var MATCH_MODES = ['contains', 'startsWith', 'endsWith'];
  var ACTIONS = ['remove', 'replace'];

  /* Longest title the pipeline will produce. Real YouTube titles cap at 100
     characters; this leaves plenty of room for replacements while stopping
     chained rules (each turning "a" into "aaaaaaaaaa", say) from multiplying a
     title into millions of characters and taking the tab down with it. */
  var MAX_TITLE_LENGTH = 500;

  /**
   * Lowercase a string while guaranteeing the result has the exact same length
   * (in UTF-16 code units) as the input.
   *
   * Why: we find matches in a lowercased copy and then slice the ORIGINAL
   * string at those indices. A few characters change length when lowercased
   * (e.g. 'İ' -> 'i̇'), which would shift every index after them and
   * corrupt the output. Folding one code unit at a time and keeping the
   * original whenever the mapping isn't 1:1 keeps indices aligned.
   */
  function safeFold(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      var low = ch.toLowerCase();
      out += low.length === 1 ? low : ch;
    }
    return out;
  }

  function isBlank(value) {
    return typeof value !== 'string' || value.trim() === '';
  }

  /**
   * A rule is valid when it could actually do something predictable.
   * Invalid rules are still stored (so the user can fix them) but never run.
   */
  function isRuleValid(rule) {
    if (!rule || typeof rule !== 'object') return false;
    if (MATCH_MODES.indexOf(rule.match) === -1) return false;
    if (ACTIONS.indexOf(rule.action) === -1) return false;
    if (isBlank(rule.find)) return false;
    // Replace with nothing is just Remove; the spec calls that invalid so the
    // user picks the clearer option.
    if (rule.action === 'replace' && (typeof rule.replacement !== 'string' || rule.replacement.length === 0)) {
      return false;
    }
    return true;
  }

  /** Human-readable reason a rule isn't running, or null when it's fine. */
  function ruleInvalidReason(rule) {
    if (!rule || typeof rule !== 'object') return 'This rule is incomplete.';
    if (isBlank(rule.find)) return 'Enter the text to look for.';
    if (rule.action === 'replace' && (typeof rule.replacement !== 'string' || rule.replacement.length === 0)) {
      return 'Enter replacement text, or switch to Remove.';
    }
    if (MATCH_MODES.indexOf(rule.match) === -1 || ACTIONS.indexOf(rule.action) === -1) {
      return 'This rule is incomplete.';
    }
    return null;
  }

  function substitution(rule) {
    return rule.action === 'replace' ? rule.replacement : '';
  }

  /** Apply a single valid rule to a title. Literal text only — never regex. */
  function applyRule(title, rule) {
    var find = rule.find;
    var replaceWith = substitution(rule);
    var haystack = rule.caseSensitive ? title : safeFold(title);
    var needle = rule.caseSensitive ? find : safeFold(find);

    if (needle.length === 0) return title;

    if (rule.match === 'startsWith') {
      if (haystack.indexOf(needle) !== 0) return title;
      return replaceWith + title.slice(needle.length);
    }

    if (rule.match === 'endsWith') {
      var at = haystack.length - needle.length;
      if (at < 0 || haystack.lastIndexOf(needle) !== at) return title;
      return title.slice(0, at) + replaceWith;
    }

    // contains: every non-overlapping occurrence, scanning left to right.
    var out = '';
    var cursor = 0;
    while (cursor <= haystack.length - needle.length) {
      var hit = haystack.indexOf(needle, cursor);
      if (hit === -1) break;
      out += title.slice(cursor, hit) + replaceWith;
      cursor = hit + needle.length;
    }
    if (cursor === 0) return title;
    return out + title.slice(cursor);
  }

  /**
   * Run the whole pipeline over an original title.
   *
   * Always starts from the original, so turning a rule off or reordering rules
   * recalculates cleanly instead of compounding earlier edits.
   *
   * @returns {string} the title to display
   */
  function applyRules(originalTitle, config) {
    if (typeof originalTitle !== 'string') return originalTitle;
    if (!config || config.enabled === false) return originalTitle;

    var rules = Array.isArray(config.rules) ? config.rules : [];
    var current = originalTitle;
    var changed = false;
    var limit = Math.max(MAX_TITLE_LENGTH, originalTitle.length);

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule || !rule.enabled) continue;
      if (!isRuleValid(rule)) continue;
      var next = applyRule(current, rule);
      // Checked after every rule, so a runaway chain stops before it grows.
      if (next.length > limit) return originalTitle;
      if (next !== current) {
        changed = true;
        current = next;
      }
    }

    // An untouched title is left exactly as YouTube supplied it — we don't even
    // trim it, so "no rule matched" is indistinguishable from "extension off".
    if (!changed) return originalTitle;

    current = current.trim();

    // Transforming a title into nothing is never what the user wanted.
    if (current === '') return originalTitle;

    return current;
  }

  /** `Starts with "NEW VIDEO:" -> Remove` for the collapsed card. */
  function describeRule(rule) {
    var labels = { contains: 'Contains', startsWith: 'Starts with', endsWith: 'Ends with' };
    var condition = labels[rule && rule.match] || 'Contains';
    var find = rule && typeof rule.find === 'string' ? rule.find : '';
    var left = condition + ' ' + (find === '' ? '…' : '“' + find + '”');
    if (rule && rule.action === 'replace') {
      var rep = typeof rule.replacement === 'string' ? rule.replacement : '';
      return left + ' → Replace with ' + (rep === '' ? '…' : '“' + rep + '”');
    }
    return left + ' → Remove';
  }

  var api = {
    MATCH_MODES: MATCH_MODES,
    ACTIONS: ACTIONS,
    MAX_TITLE_LENGTH: MAX_TITLE_LENGTH,
    safeFold: safeFold,
    isRuleValid: isRuleValid,
    ruleInvalidReason: ruleInvalidReason,
    applyRule: applyRule,
    applyRules: applyRules,
    describeRule: describeRule
  };

  global.TitleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
