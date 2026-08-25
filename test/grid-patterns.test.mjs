/* Grid interaction (Kyle, 2026-08-24), settled over four rounds.

   The last one decides the shape: **"I want to nav with L and R and tab"**.

   That is not a tweak. ← and → cannot navigate while a cell is a live text
   input, because the caret is already using them — the earlier hover-live
   direction claimed both and could only have one. Wanting them for
   navigation means cells REST as values and open on purpose, which is a
   resting state whether or not anyone calls it a mode.

   Two things fall out, and both are wins Kyle did not ask for:
     · Space is free at rest, so keyboard row selection comes for nothing —
       the H-versus-K question from the previous round dissolves.
     · Hover has something to do: it shows the control a click would open.

   What is left open is the one thing the two challengers disagree about:
   when a cell IS open, do ← and → still navigate?
     REST  no — the caret owns them until you Tab, Return or Esc out.
     EDGE  yes — they walk the caret and step out at the text edge, so the
           keys never stop meaning "navigate" and there is no mode to be in.

   The keymap core lives in docs/mockups/table-grid-keymaps.html, in one
   <script id="pattern-core"> block, so the page Kyle drives and the
   behaviour asserted here cannot drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'docs/mockups/table-grid-keymaps.html'), 'utf8');
const core = HTML.match(/<script id="pattern-core">([\s\S]*?)<\/script>/)?.[1];
assert.ok(core, 'the mockup carries its keymap core in one extractable block');

const PATTERNS = await import(
  `data:text/javascript;base64,${Buffer.from(`${core}\nexport default PATTERNS;`).toString('base64')}`
).then((m) => m.default);

const IDS = ['NOW', 'REST', 'EDGE'];
const CHALLENGERS = ['REST', 'EDGE'];

const k = (key, mod = {}) => ({ key, shift: false, meta: false, alt: false, ...mod });
const st = (over = {}) => ({
  mode: 'rest', r: 1, c: 1, rows: 4, cols: 6, sel: new Set(), anchor: null,
  caret: { atStart: false, atEnd: false }, ...over,
});
const at = (id, key, mod, over) => PATTERNS[id].keymap(k(key, mod), st(over));
const act = (...a) => at(...a).type;
const rest = (id) => ({ mode: PATTERNS[id].caps.homeMode });

/* ── 1 · the ask itself: L, R and Tab all navigate ─────────────────────── */
test('at rest, every arrow navigates — L and R included', () => {
  for (const id of CHALLENGERS) {
    const L = at(id, 'ArrowLeft', {}, rest(id));
    const R = at(id, 'ArrowRight', {}, rest(id));
    assert.equal(L.type, 'move', `${id}: ← moves`);
    assert.equal(L.dc, -1, `${id}: ← moves one cell left`);
    assert.equal(R.dc, 1, `${id}: → moves one cell right`);
    assert.equal(at(id, 'ArrowUp', {}, rest(id)).dr, -1, `${id}: ↑ moves up a row`);
    assert.equal(at(id, 'ArrowDown', {}, rest(id)).dr, 1, `${id}: ↓ moves down a row`);
  }
});

test('Tab navigates too, and wraps into the next row', () => {
  for (const id of CHALLENGERS) {
    const f = at(id, 'Tab', {}, rest(id));
    assert.equal(f.dc, 1, `${id}: Tab moves right`);
    assert.equal(f.wrap, 'grid', `${id}: and carries on into the next row`);
    assert.equal(at(id, 'Tab', { shift: true }, rest(id)).dc, -1, `${id}: ⇧Tab moves left`);
  }
});

test('what Kyle asked for is recorded as the reason the shape changed', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].caps.arrows, 'navigate',
      `${id}: all four arrows are navigation keys`);
    assert.notEqual(PATTERNS[id].caps.cellEdit, 'always-live',
      `${id}: cells cannot be live inputs, or ← and → would belong to the caret`);
  }
});

/* ── 2 · the resting state, and the two things it hands over ───────────── */
test('a cell rests as a value and opens on purpose', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].caps.homeMode, 'rest', `${id}: rest is where you start`);
    assert.equal(act(id, 'Enter', {}, { mode: 'rest' }), 'edit', `${id}: Return opens the cell`);
    assert.equal(act(id, 'j', {}, { mode: 'rest' }), 'edit', `${id}: so does typing, replacing the value`);
    assert.equal(act(id, 'Escape', {}, { mode: 'edit' }), 'revert', `${id}: Esc backs out, restoring the value`);
  }
});

test('the resting state hands over keyboard row selection for free', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].caps.rowSelect, 'keyboard',
      `${id}: with Space free at rest, selection costs nothing`);
    assert.equal(act(id, ' ', {}, { mode: 'rest' }), 'toggleSelect', `${id}: Space picks the row up`);
    assert.equal(act(id, 'ArrowDown', { shift: true }, { mode: 'rest' }), 'extendSelect', `${id}: ⇧↓ grows the run`);
    assert.equal(act(id, 'a', { meta: true }, { mode: 'rest' }), 'selectAll', `${id}: ⌘A takes the table`);
    assert.equal(act(id, ' ', {}, { mode: 'edit' }), 'none',
      `${id}: and inside an open cell, Space is still a space`);
  }
});

test('hover has a job again: showing the control a click would open', () => {
  for (const id of CHALLENGERS) assert.equal(PATTERNS[id].caps.hover, 'arm');
  assert.equal(PATTERNS.NOW.caps.hover, 'none', 'today every cell wears its control permanently');
});

/* ── 3 · the fork: does ← → ever stop navigating? ──────────────────────── */
test('REST gives the arrows to the caret once a cell is open', () => {
  assert.equal(PATTERNS.REST.caps.arrowsInCell, 'caret');
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(act('REST', key, {}, { mode: 'edit', caret: { atStart: true, atEnd: true } }), 'none',
      `REST: ${key} stays with the caret even at the edge of the text`);
  }
});

test('EDGE keeps them navigating, stepping out when the caret runs out of text', () => {
  assert.equal(PATTERNS.EDGE.caps.arrowsInCell, 'through-edge');
  assert.equal(act('EDGE', 'ArrowRight', {}, { mode: 'edit', caret: { atStart: false, atEnd: false } }), 'none',
    'EDGE: mid-word, → is the caret’s');
  const out = at('EDGE', 'ArrowRight', {}, { mode: 'edit', caret: { atStart: false, atEnd: true } });
  assert.equal(out.type, 'commitMove', 'EDGE: at the end of the text, → leaves the cell');
  assert.equal(out.dc, 1, 'and lands one cell right');
  const back = at('EDGE', 'ArrowLeft', {}, { mode: 'edit', caret: { atStart: true, atEnd: false } });
  assert.equal(back.dc, -1, 'EDGE: at the start of the text, ← leaves leftward');
  assert.equal(act('EDGE', 'ArrowLeft', {}, { mode: 'edit', caret: { atStart: false, atEnd: false } }), 'none',
    'EDGE: mid-word, ← is the caret’s');
});

test('an empty cell is at both edges at once, so EDGE walks straight through it', () => {
  const empty = { mode: 'edit', caret: { atStart: true, atEnd: true } };
  assert.equal(at('EDGE', 'ArrowRight', {}, empty).dc, 1, 'EDGE: → passes through an empty cell');
  assert.equal(at('EDGE', 'ArrowLeft', {}, empty).dc, -1, 'EDGE: ← passes through it too');
});

test('EDGE books the surprise it buys, and REST books the promise it breaks', () => {
  assert.ok(PATTERNS.EDGE.costs.some((c) => /edge|surprise|leave|step/i.test(c)),
    'EDGE: leaving a cell on a keypress you meant for the caret is the cost');
  assert.ok(PATTERNS.REST.costs.some((c) => /open|caret|while/i.test(c)),
    'REST: "L and R navigate" stops being true the moment a cell is open');
  assert.ok(PATTERNS.EDGE.costs.some((c) => /⇧|select|shift/i.test(c)),
    'EDGE: ⇧← selecting text inside a cell needs an answer');
});

/* ── 4 · everything already settled, still true ────────────────────────── */
test('one click still edits, and a checkbox is still one click', () => {
  for (const id of IDS) {
    assert.equal(PATTERNS[id].pointer.click, 'edit', `${id}: the plain click edits`);
    assert.equal(PATTERNS[id].pointer.checkbox, 'toggle', `${id}: one click flips the box`);
    assert.equal(PATTERNS[id].pointer.field, 'cellActivation', `${id}: a date opens its calendar`);
  }
});

test('the modifiers still carry pointer selection', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].pointer.cmdClick, 'toggleSelect');
    assert.equal(PATTERNS[id].pointer.shiftClick, 'extendSelect');
  }
});

test('the record opens as a page; the peek is not carried forward', () => {
  assert.equal(PATTERNS.NOW.pointer.cmdClick, 'peek', 'today ⌘-click opens the side peek (#133)');
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].opens, 'page', `${id}: one destination for a record, not two`);
    assert.ok(!PATTERNS[id].pointer.peek, `${id}: no pointer gesture routes to a peek`);
    assert.equal(act(id, 'Enter', { meta: true }, rest(id)), 'open', `${id}: ⌘Return opens it`);
  }
  const v = PATTERNS.NOW.peekVerdict;
  assert.equal(v.callers, 1, 'exactly one call site survives');
  assert.equal(v.qualifyingCallers, 0, 'and none is the slide-over-on-a-page case #117 kept it for');
  assert.match(v.evidence, /#117/, 'the verdict cites the feature that demoted it');
});

test('Return commits down the column; ⇧Return makes the next row', () => {
  for (const id of CHALLENGERS) {
    const r = at(id, 'Enter', {}, { mode: 'edit' });
    assert.equal(r.type, 'commitMove', `${id}: Return saves`);
    assert.equal(r.dr, 1, `${id}: and drops one row in the same column`);
    for (const mode of ['rest', 'edit']) {
      const n = at(id, 'Enter', { shift: true }, { mode, r: 1, rows: 9 });
      assert.equal(n.type, 'newRow', `${id}: ⇧Return adds an item from ${mode}`);
      assert.equal(n.at, 'below', `${id}: below the row you are standing on`);
      assert.equal(n.focus, 'first', `${id}: with the caret already in it`);
    }
  }
});

test('today the grid still answers to no keys at all', () => {
  for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'Enter', 'Escape', ' ']) {
    assert.equal(act('NOW', key, {}, rest('NOW')), 'none', `NOW: ${key} falls through to the browser`);
  }
  assert.equal(PATTERNS.NOW.caps.keyboard, 'none');
  assert.equal(PATTERNS.NOW.caps.rowSelect, 'none');
});

test('a computed cell is never opened, by click or by key', () => {
  for (const id of IDS) {
    assert.notEqual(act(id, 'Enter', {}, { ...rest(id), readonly: true }), 'edit', `${id}: not by Return`);
    assert.notEqual(act(id, 'j', {}, { ...rest(id), readonly: true }), 'edit', `${id}: not by typing`);
  }
});

test('a selected run is dropped without reaching for the mouse', () => {
  for (const id of CHALLENGERS) {
    assert.equal(act(id, 'Escape', {}, { mode: 'rest', sel: new Set([0, 1]) }), 'clearSelect');
  }
});

/* ── 5 · sold with the bill attached ───────────────────────────────────── */
test('every pattern carries costs, spelled out rather than labelled', () => {
  for (const id of IDS) {
    assert.ok(PATTERNS[id].costs.length >= 2, `${id} is not sold as free`);
    for (const c of PATTERNS[id].costs) assert.ok(c.length > 25, `${id}: a cost is a sentence — ${c}`);
  }
  const shared = PATTERNS.REST.costs.concat(PATTERNS.EDGE.costs).join(' ').toLowerCase();
  assert.ok(/hover/.test(shared), 'both book hover as the only editability cue');
  assert.ok(/rest|live|control/.test(shared), 'and the loss of the always-live grid');
});

/* ── 6 · the page is drivable, and self-contained ──────────────────────── */
test('the page wires the core to three live grids and reports every verb', () => {
  assert.match(HTML, /addEventListener\('keydown'/, 'the demo grids take keystrokes');
  assert.match(HTML, /className = 'keylog'/, 'each demo carries a strip for the verb it resolved');
  assert.match(HTML, /const SAID = \{/, 'every verb is spelled out in English under the grid');
  for (const id of IDS) assert.ok(HTML.includes(`data-pattern="${id}"`), `pattern ${id} has a live stage`);
  assert.match(HTML, /type: 'checkbox'/, 'a checkbox field is in the demo data');
  assert.match(HTML, /class="costs"/, 'every direction shows its bill');
  assert.match(HTML, /metaKey/, 'the stages honour ⌘-click');
  assert.match(HTML, /shiftKey/, 'and ⇧-click');
  assert.doesNotMatch(HTML, /<script[^>]+src=/, 'self-contained: no external assets');
  assert.doesNotMatch(HTML, /https?:\/\/(?!www\.w3\.org)/, 'self-contained: no remote fetches');
});

test('the EDGE demo tracks a real caret, or its whole claim is a mock', () => {
  assert.match(HTML, /selectionStart/, 'the caret position is read from a real input');
  assert.match(HTML, /atStart/, 'and fed to the keymap as the edge test');
});
