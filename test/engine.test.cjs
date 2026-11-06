'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

/** Build a rule with sensible defaults so tests only state what matters. */
function rule(overrides) {
  return Object.assign(
    { id: 'r', enabled: true, match: 'contains', find: '', action: 'remove', replacement: '', caseSensitive: false },
    overrides
  );
}
const cfg = (rules, enabled = true) => ({ schemaVersion: 1, enabled, rules });
const run = (title, rules, enabled = true) => E.applyRules(title, cfg(rules, enabled));

/* ---------- T04 Contains ---------- */
test('contains removes every non-overlapping occurrence', () => {
  assert.equal(run('ab Q ab R ab', [rule({ match: 'contains', find: 'ab ' })]), 'Q R ab');
  assert.equal(run('a-ab-ab-z', [rule({ match: 'contains', find: 'ab' })]), 'a---z');
  // Stripping every occurrence would leave only spaces, so the original stands (T18).
  assert.equal(run('ab ab ab', [rule({ match: 'contains', find: 'ab' })]), 'ab ab ab');
});

test('contains does not rescan its own replacement output', () => {
  // "aaaa" with find "aa" -> two non-overlapping hits, not a cascade.
  assert.equal(run('aaaa', [rule({ match: 'contains', find: 'aa', action: 'replace', replacement: 'a' })]), 'aa');
});

test('contains matches mid-word and leaves the rest intact', () => {
  assert.equal(
    run('Unboxing the NEW thing', [rule({ match: 'contains', find: 'NEW ', action: 'remove' })]),
    'Unboxing the thing'
  );
});

/* ---------- T05 Starts with ---------- */
test('startsWith only matches the beginning, once', () => {
  const r = [rule({ match: 'startsWith', find: 'NEW VIDEO:' })];
  assert.equal(run('NEW VIDEO: Hello', r), 'Hello');
  assert.equal(run('Re: NEW VIDEO: Hello', r), 'Re: NEW VIDEO: Hello');
  assert.equal(run('NEW VIDEO: NEW VIDEO: Hi', r), 'NEW VIDEO: Hi');
});

/* ---------- T06 Ends with ---------- */
test('endsWith only matches the ending, once', () => {
  const r = [rule({ match: 'endsWith', find: ' | Podcast' })];
  assert.equal(run('Episode 4 | Podcast', r), 'Episode 4');
  assert.equal(run('Episode 4 | Podcast extra', r), 'Episode 4 | Podcast extra');
  assert.equal(run('A | Podcast | Podcast', r), 'A | Podcast');
});

/* ---------- T07 Case sensitivity ---------- */
test('matching is case-insensitive by default', () => {
  assert.equal(run('new video: Hi', [rule({ match: 'startsWith', find: 'NEW VIDEO:' })]), 'Hi');
});

test('caseSensitive true requires an exact match', () => {
  const r = [rule({ match: 'startsWith', find: 'NEW VIDEO:', caseSensitive: true })];
  assert.equal(run('new video: Hi', r), 'new video: Hi');
  assert.equal(run('NEW VIDEO: Hi', r), 'Hi');
});

test('case-insensitive matching preserves surrounding original casing', () => {
  assert.equal(
    run('MiXeD CaSe HeRe', [rule({ match: 'contains', find: 'case', action: 'replace', replacement: 'X' })]),
    'MiXeD X HeRe'
  );
});

test('safeFold never changes string length', () => {
  for (const s of ['İstanbul', 'ÄÖÜ', 'straße', '👾 emoji', 'ĲSSELMEER']) {
    assert.equal(E.safeFold(s).length, s.length, `length changed for ${s}`);
  }
});

test('length-changing uppercase letters do not corrupt slicing', () => {
  // 'İ' (I with dot above) lowercases to 2 code units in plain toLowerCase.
  assert.equal(run('İX keep', [rule({ match: 'contains', find: 'keep', action: 'remove' })]), 'İX');
});

/* ---------- T08 / T09 Remove and Replace ---------- */
test('remove deletes only the targeted text', () => {
  assert.equal(run('[4K] Sunset', [rule({ match: 'contains', find: '[4K] ' })]), 'Sunset');
});

test('replace substitutes the matched text', () => {
  assert.equal(
    run('I tried EVERYTHING', [rule({ match: 'contains', find: 'EVERYTHING', action: 'replace', replacement: 'a thing' })]),
    'I tried a thing'
  );
});

test('brackets and regex metacharacters are treated as literal text', () => {
  assert.equal(run('a.b.c', [rule({ match: 'contains', find: '.', action: 'replace', replacement: '-' })]), 'a-b-c');
  assert.equal(run('100% (real)', [rule({ match: 'contains', find: '(real)', action: 'remove' })]), '100%');
  assert.equal(run('a+b', [rule({ match: 'contains', find: 'a+b', action: 'replace', replacement: 'ok' })]), 'ok');
  assert.equal(run('x$1y', [rule({ match: 'contains', find: 'x', action: 'replace', replacement: '$&' })]), '$&$1y');
});

/* ---------- T14 Multiple rules / processing order ---------- */
test('rules run top to bottom, each on the previous output', () => {
  const rules = [
    rule({ id: '1', match: 'startsWith', find: 'NEW VIDEO:' }),
    rule({ id: '2', match: 'contains', find: 'Part', action: 'replace', replacement: 'Ep' })
  ];
  assert.equal(run('NEW VIDEO: Part 3', rules), 'Ep 3');
});

test('order changes the result', () => {
  const a = rule({ id: 'a', match: 'contains', find: 'ab', action: 'replace', replacement: 'b' });
  const b = rule({ id: 'b', match: 'contains', find: 'bb', action: 'replace', replacement: 'Z' });
  assert.equal(run('abb', [a, b]), 'Z');
  assert.equal(run('abb', [b, a]), 'aZ');
});

/* ---------- T10 / T12 Disabled rules and global off ---------- */
test('disabled rules are skipped but later rules still run', () => {
  const rules = [
    rule({ id: '1', enabled: false, match: 'startsWith', find: 'NEW VIDEO:' }),
    rule({ id: '2', match: 'contains', find: 'Part', action: 'replace', replacement: 'Ep' })
  ];
  assert.equal(run('NEW VIDEO: Part 3', rules), 'NEW VIDEO: Ep 3');
});

test('global disable returns the original title untouched', () => {
  assert.equal(run('  NEW VIDEO: Hi  ', [rule({ match: 'startsWith', find: 'NEW' })], false), '  NEW VIDEO: Hi  ');
});

/* ---------- T17 Invalid rules ---------- */
test('blank or whitespace-only find makes a rule invalid and inert', () => {
  for (const find of ['', '   ', '\t\n']) {
    assert.equal(E.isRuleValid(rule({ find })), false);
    assert.equal(run('Untouched title', [rule({ find })]), 'Untouched title');
  }
});

test('replace with an empty replacement is invalid and inert', () => {
  const r = rule({ match: 'contains', find: 'a', action: 'replace', replacement: '' });
  assert.equal(E.isRuleValid(r), false);
  assert.equal(run('a title', [r]), 'a title');
});

test('a single space is a valid replacement', () => {
  const r = rule({ match: 'contains', find: '_', action: 'replace', replacement: ' ' });
  assert.equal(E.isRuleValid(r), true);
  assert.equal(run('a_b', [r]), 'a b');
});

test('unknown match or action values are invalid', () => {
  assert.equal(E.isRuleValid(rule({ match: 'regex', find: 'a' })), false);
  assert.equal(E.isRuleValid(rule({ action: 'uppercase', find: 'a' })), false);
});

test('an invalid rule does not block valid ones around it', () => {
  const rules = [
    rule({ id: '1', find: '' }),
    rule({ id: '2', match: 'contains', find: 'Part', action: 'replace', replacement: 'Ep' }),
    rule({ id: '3', action: 'replace', find: 'x', replacement: '' })
  ];
  assert.equal(run('Part 3', rules), 'Ep 3');
});

/* ---------- T18 Empty result ---------- */
test('a result that would be empty restores the original', () => {
  assert.equal(run('Hello', [rule({ match: 'contains', find: 'Hello' })]), 'Hello');
});

test('a result that would be whitespace-only restores the original', () => {
  assert.equal(run('Hello world', [rule({ match: 'contains', find: 'Hello' }), rule({ id: '2', match: 'contains', find: 'world' })]), 'Hello world');
});

/* ---------- Whitespace handling ---------- */
test('leading and trailing whitespace is trimmed from a changed title', () => {
  assert.equal(run('NEW VIDEO:   Hello  ', [rule({ match: 'startsWith', find: 'NEW VIDEO:' })]), 'Hello');
});

test('internal whitespace is preserved', () => {
  assert.equal(run('[x] A   B\tC', [rule({ match: 'contains', find: '[x] ' })]), 'A   B\tC');
});

test('an unmatched title keeps its own stray whitespace', () => {
  assert.equal(run('  padded  ', [rule({ match: 'contains', find: 'zzz' })]), '  padded  ');
});

test('a rule that makes no difference does not count as a change', () => {
  // Replacing text with itself leaves the title byte-identical, padding included.
  assert.equal(run(' same ', [rule({ match: 'contains', find: 'same', action: 'replace', replacement: 'same' })]), ' same ');
});

/* ---------- Unicode, emoji, punctuation ---------- */
test('emoji and non-Latin text survive untargeted', () => {
  assert.equal(run('🔥 Проверка 日本語 — ok', [rule({ match: 'contains', find: 'zzz' })]), '🔥 Проверка 日本語 — ok');
  assert.equal(run('🔥🔥 Title 🔥', [rule({ match: 'contains', find: '🔥' })]), 'Title');
  assert.equal(run('ПРИВЕТ мир', [rule({ match: 'contains', find: 'привет ' })]), 'мир');
});

test('em dashes and smart quotes are matched literally', () => {
  assert.equal(run('Title — “quoted”', [rule({ match: 'contains', find: ' — “quoted”' })]), 'Title');
});

/* ---------- Robustness of inputs ---------- */
test('non-string and empty titles are handled without throwing', () => {
  assert.equal(E.applyRules('', cfg([rule({ match: 'contains', find: 'a' })])), '');
  assert.equal(E.applyRules(null, cfg([])), null);
  assert.equal(E.applyRules(undefined, cfg([])), undefined);
});

test('missing or malformed config is treated as a no-op', () => {
  assert.equal(E.applyRules('Title', null), 'Title');
  assert.equal(E.applyRules('Title', {}), 'Title');
  assert.equal(E.applyRules('Title', { enabled: true, rules: 'nope' }), 'Title');
  assert.equal(E.applyRules('Title', { enabled: true, rules: [null, undefined] }), 'Title');
});

test('find longer than the title never matches', () => {
  for (const match of ['contains', 'startsWith', 'endsWith']) {
    assert.equal(run('ab', [rule({ match, find: 'abcdef' })]), 'ab');
  }
});

/* ---------- describeRule ---------- */
test('describeRule summarises a rule for the collapsed card', () => {
  assert.equal(E.describeRule(rule({ match: 'startsWith', find: 'NEW VIDEO:' })), 'Starts with “NEW VIDEO:” → Remove');
  assert.equal(
    E.describeRule(rule({ match: 'contains', find: 'a', action: 'replace', replacement: 'b' })),
    'Contains “a” → Replace with “b”'
  );
  assert.match(E.describeRule(rule({ find: '' })), /…/);
});

/* ---------- ruleInvalidReason ---------- */
test('ruleInvalidReason explains the problem, or returns null when valid', () => {
  assert.match(E.ruleInvalidReason(rule({ find: '  ' })), /text to look for/i);
  assert.match(E.ruleInvalidReason(rule({ find: 'a', action: 'replace', replacement: '' })), /replacement/i);
  assert.equal(E.ruleInvalidReason(rule({ find: 'a' })), null);
});

/* ---------- Security: bounded output ---------- */
test('chained rules cannot grow a title past the cap', () => {
  // Each rule turns every "a" into ten, so seven rules would mean ~10M chars.
  const grow = Array.from({ length: 7 }, (_, i) =>
    rule({ id: 'g' + i, find: 'a', action: 'replace', replacement: 'aaaaaaaaaa', caseSensitive: true }));
  assert.equal(run('a video title', grow), 'a video title');
});

test('replacements that stay under the cap still apply', () => {
  const out = run('Hi', [rule({ find: 'Hi', action: 'replace', replacement: 'x'.repeat(200) })]);
  assert.equal(out, 'x'.repeat(200));
});

test('a title already over the cap can still be shortened', () => {
  const long = 'NEW: ' + 'y'.repeat(600);
  assert.equal(run(long, [rule({ match: 'startsWith', find: 'NEW: ' })]), 'y'.repeat(600));
});

test('markup in a replacement is returned as literal text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  assert.equal(run('Hello', [rule({ find: 'Hello', action: 'replace', replacement: payload })]), payload);
});
