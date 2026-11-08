import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHEET, SELECTORS, requirementSets, classesOf, requiredClasses, trimCss, usedTabler, banner } from '../scripts/trim-tabler.mjs';

const SHEET_CSS = readFileSync(SHEET, 'utf8');
const PRISTINE = new Set(readFileSync(SELECTORS, 'utf8').split('\n').filter(Boolean));
const TABLER = classesOf(PRISTINE);

test('every Tabler selector whose classes the app names survives in the trimmed sheet (Issue #660)', () => {
  const used = usedTabler(TABLER);
  const kept = requirementSets(SHEET_CSS);
  const missing = [...PRISTINE].filter((s) => s.split(' ').every((c) => used.has(c)) && !kept.has(s));
  assert.deepEqual(missing, [], 'the app uses Tabler classes whose rules the trimmed sheet dropped: run node scripts/trim-tabler.mjs <pristine tabler.min.css>');
});

test('a Tabler class used only by a new line of app code turns the guard red', () => {
  const used = usedTabler(TABLER, `${'el.className = "'}placeholder-glow";`);
  assert.ok(used.has('placeholder-glow'), 'a class named in source is used');
  assert.ok(!usedTabler(TABLER, 'nothing here').has('placeholder-glow'));
  assert.ok(usedTabler(TABLER, 'const c = `btn-${tone}`;').has('btn-primary'), 'a class built from a prefix keeps every class under it');
});

test('the trimmed sheet keeps the Tabler v1.4.0 licence banner and its design tokens', () => {
  assert.match(banner(SHEET_CSS), /Tabler v1\.4\.0[\s\S]*Licensed under MIT/);
  assert.match(SHEET_CSS, /:root,\[data-bs-theme=light\]\{--tblr-blue:/);
  assert.match(SHEET_CSS, /\[data-bs-theme=dark\]/);
  assert.ok(SHEET_CSS.length < 150_000, `trimmed sheet is ${SHEET_CSS.length} bytes`);
});

test('trimCss keeps element rules, nested at-rules and used classes, and drops the rest', () => {
  const css = 'body{margin:0}.a{color:red}.b,.a .c{color:blue}@media (min-width:1px){.b{x:1}.a{y:2}}@media print{.b{z:3}}@keyframes k{0%{opacity:0}}.a:not(.b){w:4}';
  assert.equal(trimCss(css, new Set(['a'])), 'body{margin:0}.a{color:red}@media (min-width:1px){.a{y:2}}@keyframes k{0%{opacity:0}}.a:not(.b){w:4}');
  assert.equal(trimCss('.a,.b{c:d}', new Set(['b'])), '.b{c:d}', 'a selector list keeps only the used selectors');
});

test('a class inside :not(), :is() or an attribute selector is not required', () => {
  assert.deepEqual(requiredClasses('.btn:not(.disabled):is(.x,.y) [class*=".z"]'), ['btn']);
  assert.deepEqual(requiredClasses('.w-1\\/2'), ['w-1/2']);
});
