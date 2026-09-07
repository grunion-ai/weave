/* A text field can be literal (Issue #86).
   A text cell dresses inline markdown — `**bold**` reads bold — which is the
   right default and no answer for a column that HOLDS syntax: a regex, a
   glob, a format string, the Showcase's Syntax column. `literal: true` on
   the field's config says "paint the characters", and every surface that
   dresses a text value asks it. The browser half is text-literal-browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';

await import('../public/field-dialog-core.js');
const FDC = globalThis.weaveFieldDialogCore ?? globalThis.fieldDialogCore;
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const HB = readFileSync(new URL('../src/handbook.js', import.meta.url), 'utf8');

test('the engine keeps literal on a text field, and only when it is true', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'T' });
  const lit = w.addField(t, { name: 'Syntax', type: 'text', config: { literal: true } });
  assert.equal(lit.config.literal, true);
  const plain = w.addField(t, { name: 'Note', type: 'text', config: { literal: false } });
  assert.equal('literal' in plain.config, false, 'false is the unmarked default and is not stored');
  // An update flips it both ways.
  w.updateField(t, lit.id, { config: { literal: false } });
  assert.equal('literal' in w.getField(t, lit.id).config, false);
  w.updateField(t, plain.id, { config: { literal: true } });
  assert.equal(w.getField(t, plain.id).config.literal, true);
});

test('the field dialog round-trips literal', () => {
  const state = FDC.stateFromDefinition({ type: 'text', config: { literal: true } });
  assert.equal(state.literal, true);
  assert.equal(FDC.definitionFromState(state).config.literal, true);
  const off = FDC.stateFromDefinition({ type: 'text', config: {} });
  assert.equal('literal' in FDC.definitionFromState(off).config, false, 'off is not written');
  const patch = FDC.editPatchConfig({ type: 'text', name: 'Syntax', literal: true }, FDC.definitionFromState(off), off);
  assert.equal(patch.literal, false, 'an edit that turns it off says so');
});

test('the grid asks the field before dressing a text value', () => {
  const cell = APP.slice(APP.indexOf("if (f.type === 'text' &&"), APP.indexOf('return dressedText(rawVal, input);'));
  assert.match(cell, /!f\.literal/, 'a literal field paints its characters');
});

test('the Handbook names the config key', () => {
  assert.match(HB, /\\`literal\\` — \\`true\\` paints the characters/, 'the text page documents literal');
});
