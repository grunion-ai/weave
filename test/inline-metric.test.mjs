import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

const rules = () => {
  const out = [];
  const tok = /([^{}]+)\{|\}/g;
  let m;
  while ((m = tok.exec(CSS))) {
    if (m[0] === '}') continue;
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    const end = CSS.indexOf('}', tok.lastIndex);
    out.push({ selector: head, body: CSS.slice(tok.lastIndex, end) });
    tok.lastIndex = end + 1;
  }
  return out;
};
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`))?.[1];
const INLINE = rules().filter((r) => /\binline-edit\b/.test(r.selector));

test('.inline-edit sets the inline metric once, at grid density, and .wv-edit reads it (Issue #786, Issue #1030)', () => {
  const base = INLINE.filter((r) => r.selector === '.inline-edit');
  assert.equal(base.length, 1, 'one bare .inline-edit rule');
  assert.equal(decl(base[0].body, '--wv-edit-pad'), '1px 4px');
  assert.equal(decl(base[0].body, '--wv-edit-fs'), 'var(--wv-grid-font)');
  const edit = rules().filter((r) => r.selector === '.wv-edit');
  assert.equal(edit.length, 1, 'one bare .wv-edit rule');
  assert.equal(decl(edit[0].body, 'padding'), 'var(--wv-edit-pad)');
  assert.equal(decl(edit[0].body, 'font-size'), 'var(--wv-edit-fs)');
});

test('the record field row is the one other density (Issue #786)', () => {
  const dens = INLINE.filter((r) => r.selector !== '.inline-edit' && decl(r.body, '--wv-edit-pad') && decl(r.body, '--wv-edit-fs'));
  assert.deepEqual(dens.map((r) => [r.selector, decl(r.body, '--wv-edit-pad'), decl(r.body, '--wv-edit-fs')]),
    [['.entity-fields .fieldrow .inline-edit', '2px 6px', 'var(--fs-secondary)']]);
});

test('no rule outside the tokens sets padding on an inline edit (Issue #786)', () => {
  const pads = INLINE.filter((r) => /(?:^|;)\s*padding(-\w+)?\s*:/.test(r.body) && decl(r.body, 'padding') !== 'var(--wv-edit-pad)');
  assert.deepEqual(pads.map((r) => r.selector), []);
  const sizes = INLINE.filter((r) => r.selector !== '.inline-edit' && decl(r.body, 'font-size') && /^\.wv-grid|^\.wv-sum|^\.entity-fields/.test(r.selector));
  assert.deepEqual(sizes.map((r) => r.selector), [], 'a density host sets the size through --wv-edit-fs');
});
