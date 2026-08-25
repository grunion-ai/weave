/* Grid interaction (Kyle, 2026-08-24).

   Three rounds got us here. First: "mock up at least 5 UX interact pattern
   sets that include row select, cell edit, tab/arrow/return to navigate,
   shift-enter to create new item" — seven sets, A to G. Then G, two-click:
   "click to select, click again to edit… what do we lose with this?" The
   answer was seven things, headed by a click on every edit and a checkbox
   that needed two of them. Then the correction that resolves it:

     "check boxes should not need double click. what if on hover you can
      always single click into the edit, command click and shift click
      always de/select multiple. rebuild the mock ups with only 3 (current
      and two challengers)"

   That moves selection onto the MODIFIERS, where it never competes with
   the plain click. The plain click keeps doing what Feature #133 settled,
   hover says so before you commit to it, and a checkbox stays one click.
   So the field narrows to three: what ships today, and the two ways of
   finishing it that differ on ONE question — can a row be selected
   without a mouse?

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

const IDS = ['NOW', 'H', 'K'];
const CHALLENGERS = ['H', 'K'];

const k = (key, mod = {}) => ({ key, shift: false, meta: false, alt: false, ...mod });
const st = (over = {}) => ({
  mode: 'cell', r: 1, c: 1, rows: 4, cols: 5, sel: new Set(), anchor: null, ...over,
});
const act = (id, key, mod, over) => PATTERNS[id].keymap(k(key, mod), st(over)).type;
const home = (id) => ({ mode: PATTERNS[id].caps.homeMode });

/* ── 1 · the field is three ────────────────────────────────────────────── */
test('three sets ship: what runs today, and two ways of finishing it', () => {
  assert.deepEqual(Object.keys(PATTERNS), IDS, 'NOW plus two challengers, in order');
  assert.match(PATTERNS.NOW.name, /now|today|ship/i, 'the baseline is labelled as the thing that already runs');
  for (const id of IDS) {
    const p = PATTERNS[id];
    assert.ok(p.thesis?.length > 40, `${id} states its bargain`);
    assert.equal(typeof p.keymap, 'function', `${id} resolves keystrokes`);
    assert.ok(p.pointer, `${id} says what each pointer gesture does`);
  }
});

test('the two challengers differ on exactly one thing, and it is named', () => {
  assert.equal(PATTERNS.H.caps.rowSelect, 'pointer-only', 'H selects with the modifiers alone');
  assert.equal(PATTERNS.K.caps.rowSelect, 'keyboard', 'K adds a keyboard path');
  assert.deepEqual(PATTERNS.H.pointer, PATTERNS.K.pointer,
    'the pointer story is identical — nothing Kyle asked for is traded away by either');
  assert.equal(PATTERNS.K.differsFrom, 'H', 'K states what it is a variation on');
  assert.match(PATTERNS.K.theOneQuestion, /mouse|keyboard/i,
    'and names the single question that separates them');
});

/* ── 2 · a checkbox is one click, everywhere ───────────────────────────── */
test('a checkbox never asks for a second click — the correction that killed G', () => {
  for (const id of IDS) {
    assert.equal(PATTERNS[id].pointer.checkbox, 'toggle',
      `${id}: one click flips the box, no select-then-click`);
  }
});

test('one plain click reaches every field type, including the pickers', () => {
  for (const id of IDS) {
    assert.equal(PATTERNS[id].pointer.click, 'edit', `${id}: the plain click still edits`);
    assert.equal(PATTERNS[id].pointer.field, 'cellActivation',
      `${id}: routed through the map weave already ships, so a date opens its calendar`);
  }
});

/* ── 3 · the modifiers carry selection ─────────────────────────────────── */
test('cmd-click and shift-click de/select, and never in the plain click’s way', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].pointer.cmdClick, 'toggleSelect', `${id}: ⌘-click picks a row up and puts it down`);
    assert.equal(PATTERNS[id].pointer.shiftClick, 'extendSelect', `${id}: ⇧-click takes the run between`);
    assert.equal(PATTERNS[id].pointer.click, 'edit', `${id}: and the unmodified click is untouched`);
  }
  assert.equal(PATTERNS.NOW.caps.rowSelect, 'none', 'today there is no selection to speak of');
});

test('taking cmd-click for selection evicts the side peek, and both challengers say where it went', () => {
  assert.equal(PATTERNS.NOW.pointer.cmdClick, 'peek', 'today ⌘-click opens the row in the side peek (#133)');
  for (const id of CHALLENGERS) {
    assert.notEqual(PATTERNS[id].pointer.cmdClick, 'peek', `${id} spends the gesture on selection`);
    assert.match(PATTERNS[id].collides, /peek/i, `${id} names the collision rather than hiding it`);
    assert.equal(act(id, 'Enter', { meta: true }, home(id)), 'open',
      `${id}: ⌘Return is where the peek moved to`);
  }
});

/* ── 4 · hover says what a click will do, before you spend it ──────────── */
test('the challengers arm a cell on hover; today nothing announces itself', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].caps.hover, 'arm',
      `${id}: hovering shows the control the click is about to open`);
  }
  assert.equal(PATTERNS.NOW.caps.hover, 'none',
    'today every cell wears its control permanently, so hover has nothing left to reveal');
});

/* ── 5 · the keyboard, which today does not exist ──────────────────────── */
test('today the grid answers to no keys at all — the honest baseline', () => {
  for (const key of ['Tab', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.equal(act('NOW', key, {}, home('NOW')), 'none', `NOW: ${key} falls through to the browser`);
  }
  assert.equal(act('NOW', 'Enter', { shift: true }, home('NOW')), 'none', 'NOW: ⇧Return does nothing');
  assert.equal(PATTERNS.NOW.caps.keyboard, 'none');
});

test('both challengers navigate with Tab, wrapping into the next row', () => {
  for (const id of CHALLENGERS) {
    const f = PATTERNS[id].keymap(k('Tab'), st(home(id)));
    const b = PATTERNS[id].keymap(k('Tab', { shift: true }), st(home(id)));
    assert.equal(f.dc, 1, `${id}: Tab moves right`);
    assert.equal(b.dc, -1, `${id}: ⇧Tab moves left`);
    assert.equal(f.wrap, 'grid', `${id}: and carries on into the next row`);
  }
});

test('up and down walk the column; left and right stay with the text caret', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].keymap(k('ArrowDown'), st(home(id))).dr, 1, `${id}: ↓ moves down one row`);
    assert.equal(PATTERNS[id].keymap(k('ArrowUp'), st(home(id))).dr, -1, `${id}: ↑ moves up one`);
    assert.equal(act(id, 'ArrowRight', {}, { mode: 'cell' }), 'none',
      `${id}: a live cell keeps its arrows, so a typist is never interrupted mid-word`);
  }
});

test('Return commits and moves down; shift-Return makes the next row', () => {
  for (const id of CHALLENGERS) {
    const r = PATTERNS[id].keymap(k('Enter'), st({ mode: 'cell' }));
    assert.equal(r.type, 'commitMove', `${id}: Return saves`);
    assert.equal(r.dr, 1, `${id}: and drops to the same column one row down`);
    const n = PATTERNS[id].keymap(k('Enter', { shift: true }), st(home(id)));
    assert.equal(n.type, 'newRow', `${id}: ⇧Return adds an item`);
    assert.equal(n.at, 'below', `${id}: below the row you are standing on`);
    assert.equal(n.focus, 'first', `${id}: with the caret already in it`);
  }
});

test('shift-Return works from the middle of a table, not only at the bottom', () => {
  for (const id of CHALLENGERS) {
    assert.equal(PATTERNS[id].keymap(k('Enter', { shift: true }), st({ r: 1, rows: 9, ...home(id) })).type, 'newRow');
  }
});

/* ── 6 · the one question: can a row be selected without a mouse? ──────── */
test('H cannot select from the keyboard, and does not pretend otherwise', () => {
  for (const key of [' ', 'x']) {
    assert.notEqual(act('H', key, {}, home('H')), 'toggleSelect', `H: ${key} is not a selection key`);
  }
  assert.notEqual(act('H', 'ArrowDown', { shift: true }, home('H')), 'extendSelect',
    'H: ⇧↓ is not a selection gesture either — the modifiers are pointer-only');
  assert.ok(PATTERNS.H.costs.some((c) => /mouse|pointer|keyboard/i.test(c)),
    'and the pattern books that as a cost');
});

test('K pops out to a nav mode, where the mouse is not needed', () => {
  assert.deepEqual(PATTERNS.K.caps.modes, ['cell', 'nav'], 'two modes, entered by Escape');
  assert.equal(act('K', 'Escape', {}, { mode: 'cell' }), 'exit', 'Esc leaves the cell for the map');
  assert.equal(act('K', ' ', {}, { mode: 'nav' }), 'toggleSelect', 'nav: Space picks the row up');
  assert.equal(act('K', 'ArrowDown', { shift: true }, { mode: 'nav' }), 'extendSelect', 'nav: ⇧↓ grows the run');
  assert.equal(act('K', 'a', { meta: true }, { mode: 'nav' }), 'selectAll', 'nav: ⌘A takes the table');
  assert.equal(act('K', 'Enter', {}, { mode: 'nav' }), 'edit', 'nav: Return drops back into the cell');
});

test('K mode is only ever entered on purpose', () => {
  assert.equal(PATTERNS.K.caps.homeMode, 'cell', 'a cell is where you start and where you stay');
  assert.equal(act('K', ' ', {}, { mode: 'cell' }), 'none',
    'Space in a live cell types a space — the mode never grabs a key out from under a typist');
  assert.ok(PATTERNS.K.costs.some((c) => /mode/i.test(c)), 'and the mode is booked as the cost it is');
});

test('a selected run is dropped without reaching for the mouse, in both', () => {
  for (const id of CHALLENGERS) {
    assert.equal(act(id, 'Escape', {}, { mode: PATTERNS[id].caps.homeMode, sel: new Set([0, 1]) }), 'clearSelect',
      `${id}: Esc drops the selection first`);
  }
});

/* ── 7 · nothing raises an editor on a value nobody can type into ──────── */
test('a computed cell is never opened, by click or by key', () => {
  for (const id of IDS) {
    assert.notEqual(PATTERNS[id].keymap(k('Enter'), st({ ...home(id), readonly: true })).type, 'edit',
      `${id}: no editor on a formula cell`);
  }
});

/* ── 8 · each direction is sold with its bill attached ─────────────────── */
test('every pattern carries costs, spelled out rather than labelled', () => {
  for (const id of IDS) {
    assert.ok(PATTERNS[id].costs.length >= 2, `${id} is not sold as free`);
    for (const c of PATTERNS[id].costs) assert.ok(c.length > 25, `${id}: a cost is a sentence, not a word — ${c}`);
  }
  assert.ok(PATTERNS.NOW.costs.some((c) => /keyboard|key/i.test(c)), 'the baseline books its missing keyboard');
  assert.ok(PATTERNS.NOW.costs.some((c) => /select/i.test(c)), 'and its missing selection');
});

/* ── 9 · the page is drivable, and self-contained ──────────────────────── */
test('the page wires the core to three live grids and reports every verb', () => {
  assert.match(HTML, /addEventListener\('keydown'/, 'the demo grids take keystrokes');
  assert.match(HTML, /className = 'keylog'/, 'each demo carries a strip for the verb it resolved');
  assert.match(HTML, /const SAID = \{/, 'every verb is spelled out in English under the grid');
  for (const id of IDS) assert.ok(HTML.includes(`data-pattern="${id}"`), `pattern ${id} has a live stage`);
  assert.doesNotMatch(HTML, /data-pattern="[A-G]"/, 'the seven-way study is gone, not merely hidden');
  assert.match(HTML, /metaKey/, 'the stages honour ⌘-click');
  assert.match(HTML, /shiftKey/, 'and ⇧-click');
  assert.doesNotMatch(HTML, /<script[^>]+src=/, 'self-contained: no external assets');
  assert.doesNotMatch(HTML, /https?:\/\/(?!www\.w3\.org)/, 'self-contained: no remote fetches');
});

test('the page demonstrates the checkbox claim with a real checkbox column', () => {
  assert.match(HTML, /type: 'checkbox'/, 'a checkbox field is in the demo data');
  assert.match(HTML, /class="costs"/, 'and every direction shows its bill on the page');
});
