'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/storage.js');
const S = globalThis.TitleStore;

/* ---------- Security: bounded storage ---------- */
test('normalize keeps at most MAX_RULES rules', () => {
  const rules = Array.from({ length: S.MAX_RULES + 25 }, (_, i) => ({ id: 'r' + i, find: 'x' }));
  const out = S.normalize({ rules });
  assert.equal(out.rules.length, S.MAX_RULES);
  assert.equal(out.rules[0].id, 'r0'); // keeps the first ones, in order
});

test('normalize trims oversized find and replacement text', () => {
  const big = 'z'.repeat(S.MAX_FIELD_LENGTH * 10);
  const [r] = S.normalize({ rules: [{ id: 'a', find: big, action: 'replace', replacement: big }] }).rules;
  assert.equal(r.find.length, S.MAX_FIELD_LENGTH);
  assert.equal(r.replacement.length, S.MAX_FIELD_LENGTH);
});

test('normalize turns hostile values into a safe default shape', () => {
  const out = S.normalize({ enabled: 'yes', rules: [null, 42, { match: '__proto__', action: 'eval', find: {} }] });
  assert.equal(out.enabled, true);
  assert.equal(out.rules.length, 3);
  out.rules.forEach((r) => {
    assert.equal(r.match, 'contains');
    assert.equal(r.action, 'remove');
    assert.equal(r.find, '');
    assert.equal(r.enabled, false);
  });
});
