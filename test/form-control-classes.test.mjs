import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const APP = read('app.js');
const CSS = read('style.css');

const controls = () => [...APP.matchAll(/\{[^{}]*class: '([^']*\bform-control\b[^']*)'[^{}]*\}/g)]
  .map((m) => ({ classes: m[1].split(/\s+/), attrs: m[0], line: APP.slice(0, m.index).split('\n').length }));

test('a form-control never carries the dead "full" class (Issue #787)', () => {
  const found = controls();
  assert.ok(found.length > 10, `found ${found.length} form-control sites`);
  assert.deepEqual(found.filter((c) => c.classes.includes('full')).map((c) => c.line), []);
});

test('a form-control never sets an inline width of 100%, which .form-control already sets (Issue #787)', () => {
  assert.deepEqual(controls().filter((c) => /style: '[^']*width:\s*100%/.test(c.attrs)).map((c) => c.line), []);
});

test('the bug note is a small form field and keeps no size or padding of its own (Issue #787)', () => {
  const note = controls().find((c) => c.classes.includes('bug-note'));
  assert.ok(note, 'the bug note is built as a form-control');
  assert.ok(note.classes.includes('form-control-sm'), note.classes.join(' '));
  const rules = [...CSS.matchAll(/(^|\})\s*([^{}]*\.bug-note[^{}]*)\{([^}]*)\}/g)].filter((m) => !/::placeholder/.test(m[2]));
  assert.ok(rules.length, 'a .bug-note rule exists');
  for (const m of rules) assert.doesNotMatch(m[3], /font-size|padding/, `${m[2].trim()} { ${m[3].trim()} }`);
});
