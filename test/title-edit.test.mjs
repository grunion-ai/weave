import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './lib/source.mjs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const APP = read('app.js');

const SHARED = ['font-weight', 'font-family', 'color', 'min-width', 'flex'];
const declares = (body, prop) => new RegExp(`(^|;)\\s*${prop}\\s*:`).test(body);

test('one builder makes both the page heading editor and the record name editor (Issue #784)', () => {
  const builders = [...APP.matchAll(/^(?:function titleEdit\(|const titleEdit = )/gm)];
  assert.equal(builders.length, 1, 'one titleEdit builder');
  const calls = [...APP.matchAll(/titleEdit\('(input|textarea)', '([a-z-]+)'/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(calls.sort(), ['input.view-title', 'textarea.name-edit']);
  assert.doesNotMatch(APP, /el\('(input|textarea)', \{[^{}]*class: '[^']*\b(view-title|name-edit)\b/, 'no title editor is built outside titleEdit');
});

test('the builder gives both editors the shared .title-edit class (Issue #784)', () => {
  const at = APP.search(/^(?:function titleEdit\(|const titleEdit = )/m);
  const body = APP.slice(at, APP.indexOf('\n}', at) + 2);
  assert.match(body, /class: `title-edit wv-edit \$\{/, body);
});

test('the shared title declarations live once on .title-edit, never on a context modifier (Issue #784)', () => {
  const all = cssRules();
  const base = all.filter((r) => r.selector === '.title-edit');
  assert.equal(base.length, 1, 'one .title-edit rule');
  for (const prop of SHARED) assert.ok(declares(base[0].body, prop), `.title-edit declares ${prop}`);
  const modifiers = all.filter((r) => /\.view-title(?![-\w])|textarea\.name-edit/.test(r.selector) && !/:hover|:focus/.test(r.selector));
  assert.ok(modifiers.length >= 2, `found ${modifiers.length} modifier rules`);
  const repeats = modifiers.flatMap((r) => SHARED.filter((p) => declares(r.body, p)).map((p) => `${r.selector} ${p}`));
  assert.deepEqual(repeats, []);
});
