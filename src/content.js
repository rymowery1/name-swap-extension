/*
 * YouTube content adapter.
 *
 * Finds title elements on supported YouTube surfaces, swaps in the transformed
 * text, and keeps up as YouTube navigates, scrolls and re-renders.
 *
 * Guiding rule: when in doubt, touch nothing. YouTube's markup changes often,
 * and a title we can't confidently identify is better left alone than broken.
 */
(function () {
  'use strict';

  var Engine = globalThis.TitleEngine;
  var Store = globalThis.TitleStore;

  /* Candidate title elements across the five supported surfaces: home grid,
     search results, watch page main title, suggested/related, subscriptions.
     Broad on purpose — every hit is then validated before we write to it. */
  var TITLE_SELECTOR = [
    '#video-title',                                  // grid, search, list, compact cards
    'a#video-title-link',                            // home grid wrapper
    'h1.ytd-watch-metadata yt-formatted-string',     // watch page main title
    'ytd-watch-metadata #title h1',                  // watch page (newer markup)
    'a.ytLockupMetadataViewModelTitle',              // lockup components (suggested, search)
    'yt-lockup-view-model h3 a',                     // same, via structure rather than class
    '.yt-lockup-metadata-view-model__title',         // older lockup class names
    '.yt-lockup-metadata-view-model-wiz__title'
  ].join(',');

  /* Surfaces explicitly out of scope for v1. */
  var EXCLUDE_SELECTOR = [
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    '[is-shorts]'
  ].join(',');

  var MAX_DESCEND = 6;
  var LARGE_BATCH = 40; // beyond this many mutation roots, a full scan is cheaper

  var config = Store.defaults();
  var configReady = false;

  /* node -> { original, applied, videoId, titleAttr, ariaLabel }
     Strong map, pruned of disconnected nodes on every pass, so it tracks live
     DOM only and never becomes a record of browsing history. */
  var tracked = new Map();

  var observer = null;
  var scheduled = false;
  var rafId = null;
  var timerId = null;
  var fullScanQueued = true;
  var pendingRoots = new Set();

  // --- element resolution --------------------------------------------------

  /**
   * Walk down from a candidate to the element that actually holds the title
   * text, and only accept it if that text sits in plain text nodes.
   * Returns null when the structure isn't something we can safely edit.
   */
  function resolveTextTarget(el) {
    var node = el;

    for (var i = 0; i < MAX_DESCEND; i++) {
      if (node.childElementCount === 0) break;

      /* Only children that actually carry text count. Real YouTube titles sit
         beside empty siblings — a hidden `yt-icon` inside the search-result
         anchor, badges, overlays — and treating those as content would stop
         the descent and make us skip the title entirely. */
      var bearing = [];
      for (var c = 0; c < node.children.length; c++) {
        var candidate = node.children[c];
        if (candidate.textContent && candidate.textContent.trim() !== '') bearing.push(candidate);
      }
      if (bearing.length !== 1) break;

      var child = bearing[0];
      // Descend only when that child holds the whole title, so any text nodes
      // we step over are whitespace and nothing is lost.
      if (child.textContent.trim() !== node.textContent.trim()) break;
      node = child;
    }

    // Mixed element content (multiple spans, badges, icons) — leave it alone.
    if (node.childElementCount !== 0) return null;
    if (!node.textContent || node.textContent.trim() === '') return null;
    return node;
  }

  function videoIdFor(node) {
    var anchor = node.closest ? node.closest('a[href]') : null;
    var href = anchor && anchor.getAttribute('href');
    if (!href) return null;
    var match = /[?&]v=([\w-]{6,})/.exec(href) || /\/shorts\/([\w-]{6,})/.exec(href);
    return match ? match[1] : null;
  }

  function isExcluded(node) {
    return !!(node.closest && node.closest(EXCLUDE_SELECTOR));
  }

  function collectCandidates(roots) {
    var out = new Set();

    function addFrom(root) {
      if (!root || root.nodeType !== 1) return;
      if (root.matches && root.matches(TITLE_SELECTOR)) out.add(root);
      if (!root.querySelectorAll) return;
      var found = root.querySelectorAll(TITLE_SELECTOR);
      for (var i = 0; i < found.length; i++) out.add(found[i]);
    }

    if (roots === null) {
      addFrom(document.body || document.documentElement);
    } else {
      roots.forEach(addFrom);
    }
    return out;
  }

  // --- writing -------------------------------------------------------------

  /**
   * Mirror the change onto accessible labels, but only where the original text
   * is clearly identifiable inside them. Never touches href or link structure.
   */
  function syncLabels(node, state, next) {
    var original = state.original.trim();
    if (original === '') return;

    var anchor = node.closest ? node.closest('a[href]') : null;
    var targets = anchor && anchor !== node ? [node, anchor] : [node];

    targets.forEach(function (target) {
      if (!target.getAttribute) return;

      var titleAttr = target.getAttribute('title');
      if (typeof titleAttr === 'string' && titleAttr.trim() === original) {
        target.setAttribute('title', next);
      }

      var aria = target.getAttribute('aria-label');
      // aria-label is usually "<title> by <channel>, 2 days ago, 1M views".
      if (typeof aria === 'string' && aria.indexOf(original) === 0) {
        target.setAttribute('aria-label', next + aria.slice(original.length));
      }
    });
  }

  /**
   * Put a title back the way we found it.
   * @returns {string} the source title to track from here on.
   */
  function restoreNode(node, state) {
    if (node.textContent !== state.applied) {
      // YouTube re-rendered this element since we wrote to it, so whatever is
      // there now is the source title — ours is gone already.
      return node.textContent;
    }
    node.textContent = state.original;
    syncLabelsBack(node, state);
    return state.original;
  }

  function syncLabelsBack(node, state) {
    var applied = state.applied.trim();
    if (applied === '') return;
    var anchor = node.closest ? node.closest('a[href]') : null;
    var targets = anchor && anchor !== node ? [node, anchor] : [node];

    targets.forEach(function (target) {
      if (!target.getAttribute) return;
      var titleAttr = target.getAttribute('title');
      if (typeof titleAttr === 'string' && titleAttr.trim() === applied) {
        target.setAttribute('title', state.original);
      }
      var aria = target.getAttribute('aria-label');
      if (typeof aria === 'string' && aria.indexOf(applied) === 0) {
        target.setAttribute('aria-label', state.original + aria.slice(applied.length));
      }
    });
  }

  function processNode(node) {
    var current = node.textContent;
    if (typeof current !== 'string' || current.trim() === '') return;

    var state = tracked.get(node);
    var videoId = videoIdFor(node);

    // Work out what the *source* title is right now.
    var original;
    if (state && current === state.applied && (videoId === null || videoId === state.videoId)) {
      // Unchanged since we last wrote it — our stored original still stands.
      original = state.original;
    } else {
      // First time seeing it, or YouTube recycled this element for a different
      // video / re-rendered it with new text. Treat what's there as the source.
      original = current;
    }

    var next = Engine.applyRules(original, config);

    if (next === current) {
      tracked.set(node, { original: original, applied: current, videoId: videoId });
      return;
    }

    var newState = { original: original, applied: next, videoId: videoId };
    node.textContent = next;
    syncLabels(node, newState, next);
    tracked.set(node, newState);
  }

  function pruneTracked() {
    tracked.forEach(function (_state, node) {
      if (!node.isConnected) tracked.delete(node);
    });
  }

  function processRoots(roots) {
    var candidates = collectCandidates(roots);
    if (candidates.size === 0) return;

    var seen = new Set();
    candidates.forEach(function (candidate) {
      if (isExcluded(candidate)) return;
      var target = resolveTextTarget(candidate);
      if (!target || seen.has(target)) return;
      seen.add(target);
      processNode(target);
    });
  }

  function restoreAll() {
    tracked.forEach(function (state, node) {
      if (!node.isConnected) {
        tracked.delete(node);
        return;
      }
      var source = restoreNode(node, state);
      // Keep the entry so we still know the original if rules come back on.
      tracked.set(node, { original: source, applied: source, videoId: state.videoId });
    });
  }

  // --- scheduling ----------------------------------------------------------

  /**
   * All DOM writes happen here, with the observer disconnected so our own
   * mutations never queue records and can't feed back into another pass.
   */
  function flush() {
    if (!configReady) return;
    if (!document.body) return;

    var roots = fullScanQueued || pendingRoots.size > LARGE_BATCH ? null : new Set(pendingRoots);
    fullScanQueued = false;
    pendingRoots.clear();

    stopObserving();
    try {
      pruneTracked();
      processRoots(roots);
    } catch (err) {
      // A markup surprise must never take down the page.
      console.warn('[YouTube Title Changer] skipped a pass:', err);
    } finally {
      startObserving();
    }
  }

  function cancelScheduled() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timerId !== null) clearTimeout(timerId);
    rafId = null;
    timerId = null;
    scheduled = false;
  }

  /**
   * Batch DOM work to the next frame. A background tab throttles (or stops)
   * requestAnimationFrame, so a timer runs alongside it and whichever fires
   * first wins — otherwise a tab sitting in the background could hold a stale
   * title indefinitely.
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;

    var run = function () {
      cancelScheduled();
      flush();
    };

    rafId = requestAnimationFrame(run);
    timerId = setTimeout(run, 250);
  }

  function scheduleFullScan() {
    fullScanQueued = true;
    schedule();
  }

  /** Settings changed: recalculate now rather than waiting for a paint. */
  function scanNow() {
    cancelScheduled();
    fullScanQueued = true;
    flush();
  }

  function startObserving() {
    if (!document.body) return;
    if (!observer) {
      observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var record = records[i];
          if (record.type === 'characterData') {
            var parent = record.target.parentElement;
            if (parent) pendingRoots.add(parent);
          } else {
            for (var j = 0; j < record.addedNodes.length; j++) {
              var added = record.addedNodes[j];
              if (added.nodeType === 1) pendingRoots.add(added);
              else if (added.nodeType === 3 && record.target.nodeType === 1) pendingRoots.add(record.target);
            }
          }
        }
        if (pendingRoots.size > 0) schedule();
      });
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer.takeRecords();
    }
  }

  // --- lifecycle -----------------------------------------------------------

  function onConfigChange(next) {
    var wasEnabled = config.enabled;
    config = next;

    if (!config.enabled && wasEnabled) {
      // Global pause: put every title we changed back the way we found it.
      stopObserving();
      try {
        restoreAll();
      } finally {
        startObserving();
      }
      return;
    }

    // Any other change (rules edited, reordered, toggled, or resumed) is
    // recalculated from scratch off the stored originals.
    scanNow();
  }

  function boot() {
    startObserving();
    scheduleFullScan();

    // YouTube's SPA router swaps pages without a reload.
    ['yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start'].forEach(function (name) {
      document.addEventListener(name, scheduleFullScan, true);
    });
    window.addEventListener('popstate', scheduleFullScan);

    // Staged catch-up passes for content that lands after the first paint.
    [100, 400, 1200, 3000].forEach(function (delay) {
      setTimeout(scheduleFullScan, delay);
    });
  }

  Store.load().then(
    function (loaded) {
      config = loaded;
      configReady = true;
      if (document.body) boot();
      else document.addEventListener('DOMContentLoaded', boot, { once: true });
    },
    function (err) {
      // Without settings we simply do nothing — YouTube stays untouched.
      console.warn('[YouTube Title Changer] could not read settings:', err);
    }
  );

  Store.subscribe(onConfigChange);
})();
