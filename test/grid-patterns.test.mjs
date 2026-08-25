/* Grid interaction patterns (Kyle, 2026-08-24 — "mock up at least 5 UX
   interact pattern sets that include row select, cell edit, tab/arrow/return
   to navigate, shift-enter to create new item").

   The six pattern sets live as ONE pure keymap core inside the mockup's
   <script id="pattern-core"> block — docs/mockups/table-grid-keymaps.html,
   beside table-bulk-select.html from Feature #132 — so the page a reader
   drives and the behaviour this file asserts are the same source. Nothing
   is duplicated into weave/public until a direction is picked.

   Each pattern answers the same six questions. A pattern that declines one
   (Ledger+ has no keyboard row selection at all) declares that in its
   capability record rather than inventing a keybinding to look complete —
   the decline is the design statement. */
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

const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/* A keystroke as the page sees it, and a grid state to press it against. */
const k = (key, mod = {}) => ({ key, shift: false, meta: false, alt: false, ...mod });
const st = (over = {}) => ({
  mode: 'nav', r: 1, c: 1, rows: 4, cols: 4, sel: new Set(), anchor: null, ...over,
});
/* What a pattern does with one keystroke, as a bare verb. */
const act = (id, key, mod, over) => PATTERNS[id].keymap(k(key, mod), st(over)).type;

/* ── 1 · six sets, each genuinely a different bargain ──────────────────── */
test('seven pattern sets ship, each named and thesis-ed', () => {
  assert.deepEqual(Object.keys(PATTERNS), IDS, 'A through G, in order');
  for (const id of IDS) {
    const p = PATTERNS[id];
    assert.ok(p.name?.length, `${id} has a name`);
    assert.ok(p.thesis?.length > 30, `${id} states the bargain it makes`);
    assert.equal(typeof p.keymap, 'function', `${id} resolves keystrokes`);
  }
});

test('no two patterns are the same keymap wearing different names', () => {
  const probes = [
    ['Tab', {}, {}], ['Tab', { shift: true }, {}], ['Enter', {}, {}],
    ['Enter', { shift: true }, {}], ['Enter', { meta: true }, {}],
    ['ArrowDown', {}, {}], ['ArrowRight', {}, {}], ['ArrowDown', { shift: true }, {}],
    ['ArrowDown', { meta: true }, {}], ['F2', {}, {}], ['c', { meta: true }, {}],
    ['Escape', {}, {}], [' ', {}, {}], [' ', { shift: true }, {}], ['a', {}, {}],
    ['Tab', {}, { r: 3, c: 3 }], ['Enter', {}, { mode: 'edit' }],
  ];
  const sigs = new Map();
  for (const id of IDS) {
    const sig = probes.map(([key, mod, over]) => act(id, key, mod, over)).join('|');
    assert.ok(!sigs.has(sig), `${id} and ${sigs.get(sig)} resolve identically — not orthogonal`);
    sigs.set(sig, id);
  }
});

/* ── 2 · row select ────────────────────────────────────────────────────── */
test('every pattern says how a row gets selected, including "it does not"', () => {
  for (const id of IDS) {
    const how = PATTERNS[id].caps.rowSelect;
    assert.ok(['keyboard', 'mouse-only', 'none'].includes(how), `${id} declares rowSelect (${how})`);
  }
  assert.equal(PATTERNS.A.caps.rowSelect, 'none', 'Ledger+ keeps focus as the only cursor');
  assert.equal(PATTERNS.F.caps.rowSelect, 'mouse-only', 'Form-fill spends every key on entry');
});

test('the selecting patterns toggle one row and extend a run', () => {
  for (const id of IDS.filter((x) => PATTERNS[x].caps.rowSelect === 'keyboard')) {
    const { toggle, mods = {} } = PATTERNS[id].select;
    const home = { mode: PATTERNS[id].caps.homeMode };
    assert.equal(act(id, toggle, mods, home), 'toggleSelect', `${id}: ${toggle} picks the row up`);
    assert.equal(act(id, 'ArrowDown', { shift: true }, home), 'extendSelect', `${id}: shift+↓ grows the run`);
  }
  assert.equal(PATTERNS.B.select.toggle, ' ', 'two-mode: space is free in nav mode');
  assert.equal(PATTERNS.C.select.toggle, 'x', 'row-first: x, the Gmail/Linear verb');
  assert.deepEqual(PATTERNS.G.select, { toggle: ' ', mods: { shift: true } },
    'two-click: typing replaces the cell, so a bare Space cannot be the row toggle');
});

test('a selected run is cleared without reaching for the mouse', () => {
  for (const id of IDS.filter((x) => PATTERNS[x].caps.rowSelect === 'keyboard')) {
    assert.equal(act(id, 'Escape', {}, { mode: PATTERNS[id].caps.homeMode, sel: new Set([0, 1]) }), 'clearSelect',
      `${id}: Esc drops the selection before it drops anything else`);
  }
});

/* ── 3 · cell edit ─────────────────────────────────────────────────────── */
test('every pattern says how a cell is opened for editing', () => {
  for (const id of IDS) {
    const how = PATTERNS[id].caps.cellEdit;
    assert.ok(['always-live', 'two-mode', 'in-row', 'command', 'two-click'].includes(how), `${id} declares cellEdit`);
  }
  assert.equal(PATTERNS.A.caps.cellEdit, 'always-live', 'Ledger+ never leaves edit mode, because it has none');
  assert.equal(PATTERNS.E.caps.cellEdit, 'command', 'command-led writes through ⌘K, not the cell');
  assert.equal(PATTERNS.G.caps.cellEdit, 'two-click', 'two-click makes the pointer, not a key, the mode switch');
});

test('two-mode patterns enter on Enter and leave on Escape', () => {
  for (const id of IDS.filter((x) => PATTERNS[x].caps.cellEdit === 'two-mode')) {
    assert.equal(act(id, 'Enter', {}, { mode: 'nav' }), 'edit', `${id}: Enter drops into the cell`);
    assert.equal(act(id, 'Escape', {}, { mode: 'edit' }), 'exit', `${id}: Esc backs out to the cursor`);
    assert.equal(act(id, 'j', {}, { mode: 'nav' }), 'edit', `${id}: typing replaces the value outright`);
  }
});

test('a value nobody can type into is not opened by the keymap', () => {
  for (const id of IDS) {
    const a = PATTERNS[id].keymap(k('Enter'), st({ mode: 'nav', readonly: true }));
    assert.notEqual(a.type, 'edit', `${id} does not raise an editor on a formula cell`);
  }
});

/* ── 4 · Tab and the arrows ────────────────────────────────────────────── */
test('Tab always moves along the row, Shift+Tab always back', () => {
  for (const id of IDS) {
    const f = PATTERNS[id].keymap(k('Tab'), st());
    const b = PATTERNS[id].keymap(k('Tab', { shift: true }), st());
    assert.ok(['move', 'commitMove'].includes(f.type), `${id}: Tab moves, committing on the way if it must`);
    assert.equal(f.dc, 1, `${id}: Tab moves right`);
    assert.equal(b.dc, -1, `${id}: Shift+Tab moves left`);
  }
});

test('Tab off the last cell does what the pattern promised', () => {
  const end = { r: 3, c: 3, rows: 4, cols: 4 };
  assert.equal(PATTERNS.A.keymap(k('Tab'), st(end)).wrap, 'grid', 'Ledger+ wraps into the next row');
  assert.equal(PATTERNS.C.keymap(k('Tab'), st({ ...end, mode: 'cell' })).wrap, 'row',
    'row-first keeps Tab inside the row it opened');
  assert.equal(PATTERNS.D.keymap(k('Tab'), st({ ...end, sel: new Set([2, 3]) })).wrap, 'range',
    'spreadsheet locks Tab to the selected range');
  assert.equal(PATTERNS.F.keymap(k('Tab'), st(end)).type, 'newRow',
    'form-fill grows the table rather than stopping the typist');
});

test('↑ and ↓ move a row at a time in every pattern', () => {
  for (const id of IDS) {
    const d = PATTERNS[id].keymap(k('ArrowDown'), st({ mode: PATTERNS[id].caps.homeMode }));
    assert.equal(d.type, 'move', `${id}: ↓ moves`);
    assert.equal(d.dr, 1, `${id}: ↓ moves down one row`);
    assert.equal(PATTERNS[id].keymap(k('ArrowUp'), st({ mode: PATTERNS[id].caps.homeMode })).dr, -1);
  }
});

test('← and → belong to the caret while a cell is live', () => {
  for (const id of ['A', 'F']) {
    assert.equal(act(id, 'ArrowRight'), 'none',
      `${id} never steals the arrow keys from a text cursor`);
  }
  assert.equal(PATTERNS.B.keymap(k('ArrowRight'), st({ mode: 'nav' })).dc, 1, 'two-mode: nav mode owns them');
  assert.equal(act('B', 'ArrowRight', {}, { mode: 'edit' }), 'none', 'two-mode: edit mode gives them back');
});

/* ── 5 · Return ────────────────────────────────────────────────────────── */
test('Return does exactly one of three things, and the pattern says which', () => {
  const bucket = {};
  for (const id of IDS) {
    const a = PATTERNS[id].keymap(k('Enter'), st({ mode: PATTERNS[id].caps.homeMode }));
    const verb = a.type === 'commitMove' && a.dr === 1 ? 'down' : a.type === 'open' ? 'open' : a.type;
    assert.ok(['down', 'open', 'edit'].includes(verb),
      `${id}: Return commits down the column, opens the record, or drops into the cell — got ${verb}`);
    (bucket[verb] ??= []).push(id);
  }
  assert.deepEqual(bucket.down, ['A', 'F'], 'entry-first patterns walk Return down the column');
  assert.deepEqual(bucket.open, ['C', 'E'], 'read-first patterns open the record on Return');
  assert.deepEqual(bucket.edit, ['B', 'D', 'G'], 'patterns with a resting state spend Return on entering the cell');
});

test('⌘Return opens the row wherever Return does not', () => {
  for (const id of IDS.filter((x) => PATTERNS[x].keymap(k('Enter'), st({ mode: PATTERNS[x].caps.homeMode })).type !== 'open')) {
    assert.equal(act(id, 'Enter', { meta: true }, { mode: PATTERNS[id].caps.homeMode }), 'open',
      `${id}: ⌘Return is the escape hatch to the record`);
  }
});

/* ── 6 · Shift+Return makes the next item ──────────────────────────────── */
test('Shift+Return creates a row in every pattern, and lands the caret in it', () => {
  for (const id of IDS) {
    const a = PATTERNS[id].keymap(k('Enter', { shift: true }), st({ mode: PATTERNS[id].caps.homeMode }));
    assert.equal(a.type, 'newRow', `${id}: Shift+Return adds an item`);
    assert.ok(['below', 'end'].includes(a.at), `${id}: says where the row lands`);
    assert.equal(a.focus, 'first', `${id}: the caret follows the new row into its first cell`);
  }
});

test('Shift+Return works from the middle of a table, not only at the bottom', () => {
  for (const id of IDS) {
    const a = PATTERNS[id].keymap(k('Enter', { shift: true }), st({ r: 1, rows: 9, mode: PATTERNS[id].caps.homeMode }));
    assert.equal(a.type, 'newRow', `${id}: still creates from row 1 of 9`);
  }
});

/* ── 7 · the record is always one keystroke away ───────────────────────── */
test('every pattern can open the row it is standing on', () => {
  for (const id of IDS) {
    const home = PATTERNS[id].caps.homeMode;
    const opens = [k('Enter'), k('Enter', { meta: true })]
      .some((key) => PATTERNS[id].keymap(key, st({ mode: home })).type === 'open');
    assert.ok(opens, `${id} reaches the entity without the mouse`);
  }
});

/* ── 8 · the mockup is drivable, not a picture of a keyboard ───────────── */
test('the page wires the core to real grids and says what it just did', () => {
  assert.match(HTML, /addEventListener\('keydown'/, 'the demo grids take keystrokes');
  assert.match(HTML, /className = 'keylog'/, 'each demo carries a strip for the verb it resolved');
  assert.match(HTML, /const SAID = \{/, 'every verb is spelled out in English under the grid');
  for (const id of IDS) {
    assert.ok(HTML.includes(`data-pattern="${id}"`), `pattern ${id} has a live stage`);
  }
  assert.doesNotMatch(HTML, /<script[^>]+src=/, 'self-contained: no external assets');
  assert.doesNotMatch(HTML, /https?:\/\/(?!www\.w3\.org)/, 'self-contained: no remote fetches');
});

/* ── 9 · G · two-click, and the bill it comes with ─────────────────────
   Kyle, 2026-08-24: "click to select, click again (doubleclick) to edit /
   open field-specific dialog, return to lock, arrow keys and tab to
   navigate, shift enter to create a new row" — then: "what do we lose
   with this?". The losses are asserted here, not just written down, so a
   later implementation cannot quietly claim to have avoided them. */

test('G · the pointer is the mode switch: a click selects, the next one edits', () => {
  assert.equal(PATTERNS.G.caps.homeMode, 'select', 'a cell at rest is selected, not live');
  assert.equal(PATTERNS.G.pointer.first, 'select', 'one click never opens an editor');
  assert.equal(PATTERNS.G.pointer.again, 'edit', 'the second click on that same cell opens the field');
  assert.equal(PATTERNS.G.pointer.field, 'cellActivation',
    'the second click routes through the type map weave already ships — a date opens the calendar, a select its picker');
});

test('G · Return locks rather than walking down the column', () => {
  const lock = PATTERNS.G.keymap(k('Enter'), st({ mode: 'edit' }));
  assert.equal(lock.type, 'lock', 'Return out of an open cell commits and settles');
  assert.equal(lock.dr ?? 0, 0, 'and it stays on the cell — no free trip down the column');
  assert.equal(PATTERNS.G.keymap(k('Enter'), st({ mode: 'select' })).type, 'edit', 'from rest, Return opens the cell');
});

test('G · Tab commits and lands selected, never mid-edit in the next cell', () => {
  const t = PATTERNS.G.keymap(k('Tab'), st({ mode: 'edit' }));
  assert.equal(t.type, 'commitMove', 'Tab saves on the way out');
  assert.equal(t.then, 'select', 'and the cell it lands on is selected, not opened');
});

test('G · Escape reverts the open cell before it touches the selection', () => {
  assert.equal(PATTERNS.G.keymap(k('Escape'), st({ mode: 'edit', sel: new Set([0]) })).type, 'revert',
    'an open cell is the nearer thing to back out of');
  assert.equal(PATTERNS.G.keymap(k('Escape'), st({ mode: 'select', sel: new Set([0]) })).type, 'clearSelect');
});

/* The bill. Each of these is a real cost of the two-click bargain. */
test('G · costs — typing still replaces, so Space is not free for selection', () => {
  assert.equal(PATTERNS.G.keymap(k('j'), st({ mode: 'select' })).type, 'edit',
    'a data grid has to let you type over a cell');
  assert.equal(PATTERNS.G.keymap(k(' '), st({ mode: 'select' })).type, 'none',
    'which spends the bare Space bar, unlike B');
  assert.equal(PATTERNS.G.keymap(k(' ', { shift: true }), st({ mode: 'select' })).type, 'toggleSelect',
    'so the row toggle retreats to ⇧Space — less discoverable, and the cost is real');
});

test('G · costs — column-wise entry is gone, and the pattern admits it', () => {
  const down = PATTERNS.G.keymap(k('Enter'), st({ mode: 'edit' }));
  assert.notEqual(down.dr, 1, 'Return does not advance, so 40 numbers need Return ↓ Return ↓');
  assert.ok(PATTERNS.G.costs.some((c) => /column/i.test(c)), 'the cost is stated on the pattern itself');
});

test('G · costs — every cost is written down where a reader will meet it', () => {
  assert.ok(PATTERNS.G.costs.length >= 5, 'the bargain is not sold as free');
  for (const c of PATTERNS.G.costs) assert.ok(c.length > 25, `a cost is spelled out, not a label: ${c}`);
  const all = PATTERNS.G.costs.join(' ').toLowerCase();
  for (const must of ['click', 'checkbox', 'double', 'column', 'mode']) {
    assert.ok(all.includes(must), `the write-up names the ${must} cost`);
  }
});

test('G · it reverses a shipped ruling, and says so out loud', () => {
  assert.match(PATTERNS.G.reverses, /#133|Ledger/,
    'today a single click raises the field editor; G walks that back and must cite it');
});

test('the page carries the cost accounting, not just the win', () => {
  assert.match(HTML, /class="costs"/, 'G gets a visible bill on the page');
  assert.ok(HTML.includes('data-pattern="G"'), 'pattern G has a live stage');
});
