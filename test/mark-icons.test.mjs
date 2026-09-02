/* The marks, drawn (Issue #87) — and since 2026-09-02, drawn at the weight of
   the Lucide set beside them.
   A mark was the Unicode character rendered at the font size, so every one of
   them came out a different optical size — Kyle: "bug quater done and 3/4 done
   are too small… reflresh is also too small". A size scale cannot fix that;
   the box was already right and the ink inside it was not. These are the same
   marks as flat vectors on the 24 canvas.
   The contract that matters most is the key: a row that stored '✓' months ago
   must keep working and simply start drawing. Where Lucide draws the same
   mark (a tick, a flag, a target) the character now draws the Lucide shape,
   with its motion; the six progress rings have no twin and stay drawn here. */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/field-dialog-core.js');
await import('../public/icon-registry.js');
await import('../public/mark-icons.js');
const core = globalThis.fieldDialogCore;
const marks = globalThis.weaveMarkIcons;
const reg = globalThis.weaveIconRegistry;

test('every state mark a picker offers is drawn — the key is the character', () => {
  for (const g of core.STATE_ICONS.filter(Boolean)) {
    assert.ok(marks.has(g), `${g} is offered but not drawn`);
    assert.match(marks.markSvg(g), /<(path|rect|circle)/, `${g} draws nothing`);
  }
  assert.equal(marks.has('B'), false, 'a letter stays a letter');
  assert.equal(marks.markSvg('B'), null);
});

test('the chrome marks draw too, at the same weight', () => {
  for (const ch of ['⟳', '⛶', '⧉', '‹', '↑', '↓', '+']) assert.ok(marks.has(ch), `${ch} is chrome and must draw`);
});

test('a mark with a Lucide twin names it; the rings stay drawn', () => {
  for (const ring of ['○', '◔', '◐', '◑', '◕', '●']) {
    assert.equal(marks.twin(ring), null, `${ring} has no Lucide shape`);
    assert.match(marks.markSvg(ring), /a9\.4 9\.4/, `${ring} is drawn on the 9.4 ring`);
  }
  assert.equal(marks.twin('✓'), 'check');
  assert.equal(marks.twin('⚑'), 'flag');
  assert.equal(marks.twin('→'), 'arrow-right');
  for (const [ch, twin] of Object.entries(reg.MARK_TWINS)) {
    assert.equal(marks.twin(ch), twin);
    assert.ok(marks.has(ch), `${ch} keeps its drawing as the fallback`);
  }
});

test('the drawn marks are inked at the stroke set\'s weight — 2.0, a 2.0 ring', () => {
  for (const [ch, svg] of Object.entries(marks.MARKS)) {
    for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) assert.equal(m[1], '2', `${ch} is stroked at ${m[1]}`);
  }
  // Outer r 9.4, inner r 7.4: a 2.0 ring, level with a 2.0 stroke beside it.
  assert.match(marks.MARKS['○'], /a9\.4 9\.4[^Z]*Zm0 2a7\.4 7\.4/, 'the ring is 2.0 thick');
  assert.doesNotMatch(marks.MARKS['○'], /6\.9 6\.9/, 'the 2.5 ring is gone');
});

test('nothing Iconly survives: no scale table, no hidden list, no drawn money', () => {
  assert.equal(marks.ICON_SCALE, undefined);
  assert.equal(marks.ICON_HIDDEN, undefined);
  assert.equal(marks.WEAVE_ICONS, undefined);
  assert.equal(globalThis.WEAVE_ICONS, undefined);
  assert.ok(reg.ALIASES.dollar, 'the money weave drew is an alias now');
});
