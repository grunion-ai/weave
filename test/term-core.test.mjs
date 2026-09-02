/* Tests for public/term-core.js — what one row is called, the pure half.
   The same module runs in the browser (classic script) and in the engine
   (side-effect import), so this suite is the contract both sides share. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('../public/term-core.js');
const T = globalThis.WeaveTerm;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the default term is record, and it is not "set"', () => {
  assert.deepEqual(T.resolve({}), { singular: 'record', plural: 'records', set: false });
  assert.deepEqual(T.resolve(undefined), { singular: 'record', plural: 'records', set: false });
  assert.equal(T.DEFAULT.singular, 'record');
});

test('a set term resolves with its plural, deriving one when the config lacks it', () => {
  assert.deepEqual(T.resolve({ term: { singular: 'deal', plural: 'deals' } }), { singular: 'deal', plural: 'deals', set: true });
  assert.deepEqual(T.resolve({ term: { singular: 'company' } }), { singular: 'company', plural: 'companies', set: true });
});

test('pluralize covers the English rules the list needs, plus person → people', () => {
  assert.equal(T.pluralize('deal'), 'deals');
  assert.equal(T.pluralize('company'), 'companies');
  assert.equal(T.pluralize('day'), 'days');
  assert.equal(T.pluralize('bus'), 'buses');
  assert.equal(T.pluralize('batch'), 'batches');
  assert.equal(T.pluralize('box'), 'boxes');
  assert.equal(T.pluralize('person'), 'people');
  assert.equal(T.pluralize(' Deal '), 'deals', 'trimmed and lowercased');
});

test('normalize stores lowercase, trims, derives the plural, and rejects junk', () => {
  assert.deepEqual(T.normalize({ singular: ' Deal ' }), { singular: 'deal', plural: 'deals' });
  assert.deepEqual(T.normalize({ singular: 'Person', plural: 'Folks' }), { singular: 'person', plural: 'folks' });
  assert.deepEqual(T.normalize({ singular: 'deal', plural: '  ' }), { singular: 'deal', plural: 'deals' }, 'a blank plural means derive it');
  assert.throws(() => T.normalize({ singular: 42 }), /short word/);
  assert.throws(() => T.normalize({ singular: '' }), /1–32/);
  assert.throws(() => T.normalize({ singular: 'x'.repeat(33) }), /1–32/);
  assert.throws(() => T.normalize('deal'), /singular, plural/);
});

test('count speaks the term, singular at one', () => {
  assert.equal(T.count(1, { singular: 'deal', plural: 'deals' }), '1 deal');
  assert.equal(T.count(3, { singular: 'deal', plural: 'deals' }), '3 deals');
  assert.equal(T.count(0, null), '0 records', 'no term means the default');
  assert.equal(T.count(1, undefined), '1 record');
});

test('the curated list is grouped, unique, lowercase, and starts at the default', () => {
  const opts = T.options();
  assert.ok(opts.length >= 60, `expected a long list, got ${opts.length}`);
  assert.equal(opts[0].id, 'record');
  assert.equal(opts[0].label, 'Record');
  assert.equal(new Set(opts.map((o) => o.id)).size, opts.length, 'no duplicates across groups');
  for (const o of opts) {
    assert.equal(o.id, o.id.toLowerCase(), `${o.id} is stored lowercase`);
    assert.ok(o.group, `${o.id} names its group`);
  }
  for (const noun of ['customer', 'contract', 'run', 'ticket', 'invoice', 'person']) {
    assert.ok(opts.some((o) => o.id === noun), `the list offers ${noun}`);
  }
  assert.ok(T.GROUPS.length >= 8, 'many groups, not one long column');
});

test('the module is a classic script: no import/export, one global', () => {
  const src = readFileSync(join(ROOT, 'public/term-core.js'), 'utf8');
  assert.doesNotMatch(src, /^\s*(import|export)\b/m);
  assert.match(src, /root\.WeaveTerm = /);
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('/term-core.js') > -1, 'index.html loads it');
  assert.ok(html.indexOf('/term-core.js') < html.indexOf('/selection-core.js'), 'before the modules that read it');
});
