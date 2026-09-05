/* The Ledger grid (Kyle, 2026-08-24 — direction A of the grid study).

   The grid read as a form: every cell wore a control, hovering drew a pale
   box around each one so a row looked ruled between its fields, and the only
   way to tell rows apart was to read them. Ledger takes the chrome out and
   leaves a record, then puts every control back the moment you aim at it.

   Four corrections Kyle made on the mockup, each pinned below:
     1. clicking a cell raises THAT FIELD TYPE's editor and places the cursor;
     2. the hover expansion of a clipped cell moves nothing in the grid;
     3. row hover and the active cell draw no lines between fields;
     4. ⌘-click opens the side peek — a real panel, not a mockup log line. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, rulesFor } from './lib/source.mjs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;

/* ── 1 · clicking a cell raises that field type's editor ───────────────── */

test('every field type says how a click on its cell opens it', () => {
  for (const t of ['text', 'number', 'url', 'email', 'date']) {
    assert.equal(LIB.cellActivation(t), 'focus-input', `${t} takes a caret`);
  }
  for (const t of ['select', 'multiselect', 'workflow']) {
    assert.equal(LIB.cellActivation(t), 'open-picker', `${t} opens its picker`);
  }
  assert.equal(LIB.cellActivation('relation'), 'open-button', 'a relation opens the record search');
  assert.equal(LIB.cellActivation('attachments'), 'open-button', 'attachments open the file chooser');
  assert.equal(LIB.cellActivation('checkbox'), 'toggle');
});

test('a value nobody can edit in a cell stays inert', () => {
  for (const t of ['formula', 'rollup', 'lookup', 'document', 'field']) {
    assert.equal(LIB.cellActivation(t), 'none', `${t} is not edited from the grid`);
  }
  assert.equal(LIB.cellActivation(undefined), 'none');
  assert.equal(LIB.cellActivation('something-new'), 'focus-input', 'an unknown type still takes a caret');
});

test('the grid dispatches a cell click through that map, and places the caret', () => {
  assert.match(APP, /function activateCell\(/);
  const fn = APP.match(/function activateCell\([^]*?\n\}/)[0];
  assert.match(fn, /cellActivation\(/, 'the DOM half reads the pure half');
  assert.match(fn, /setSelectionRange/, 'focusing a text cell puts the cursor in it');
  assert.match(fn, /chip-trigger|ms-box/, 'a picker cell opens its picker');
  assert.match(fn, /checked|\.click\(\)/, 'a checkbox cell toggles');
  assert.match(APP, /dataset:\s*\{[^}]*ftype/, 'each cell carries its field type for the dispatch');
});

/* ── 2 · the hover expansion moves nothing ─────────────────────────────── */

test('a clipped cell expands into an overlay, never by re-laying-out the cell', () => {
  const pop = rulesFor('.cell-pop');
  assert.equal(pop.position, 'absolute', 'the expansion is an overlay');
  assert.ok(Number.parseFloat(pop['z-index']) > 0, 'and paints above the grid');
  const fn = APP.match(/function showCellPop\([^]*?\n\}/)?.[0];
  assert.ok(fn, 'there is a renderer for the expansion');
  assert.match(fn, /cloneNode\(true\)/, 'it shows a COPY — the cell keeps its own content');
  assert.ok(!/td\.style\.(width|maxWidth|overflow|position)\s*=/.test(APP),
    'nothing rewrites the cell box on hover, so no column can move');
});

test('the overlay hangs off the scroll wrapper, which cannot clip it', () => {
  assert.equal(rulesFor('.table-wrap').position, 'relative',
    'the overlay is positioned against the wrapper, not the overflow:hidden cell');
  assert.match(APP, /cell-pop-layer/, 'one layer per grid, like the doc overlays');
});

test('a clipped cell says it is clipped before you hover it', () => {
  const after = rulesFor('.wv-grid td.clipped::after');
  assert.ok(after.content, 'a marker glyph — chips get no native ellipsis');
  assert.equal(after.position, 'absolute', 'and it costs the value no width');
  assert.match(APP, /scrollWidth\s*>\s*[\w.]+\.clientWidth/, 'clipped is measured, never assumed');
});

/* ── 3 · no lines between fields ───────────────────────────────────────── */

test('hovering a row draws no box around each of its cells', () => {
  const hov = rulesFor('.wv-grid .inline-edit:hover');
  assert.equal(hov['border-color'], 'transparent', 'a per-cell border reads as a rule between fields');
  assert.equal(hov.background, 'none', 'and so does a per-cell ground');
});

test('the active cell is the only thing wearing a border', () => {
  assert.ok(rulesFor('.wv-grid .inline-edit:focus')['border-color'],
    'focus is where the control shows itself');
  assert.deepEqual(rulesFor('.wv-grid td.cell-pick'), {},
    'no cell-type gets its own outline — the row is the unit of feedback');
});

/* ── 4 · the id link docks, ⌘-click opens a tab (one entity surface) ───── */

test('the id link docks the entity, ⌘-click opens a tab, and the row itself does neither', () => {
  const grid = APP.match(/function renderTable\([^]*?\n\}\n/)[0];
  assert.match(grid, /dataset: \{ eid: item\.id, href: registryHref\(db, item\) \?\? `#\/entity\/\$\{item\.id\}` \}/,
    'the row declares where it goes, and openNativeClick turns a ⌘-click into that tab (Issue #134)');
  assert.match(grid, /dockEntity\(db, item\.id\)/,
    'the #id link docks the entity beside the table');
  assert.ok(!/if \(openRegistryRow\(db, item\)\) return;\s*\n\s*openEntity\(item\.id\);/.test(grid),
    'a bare row click no longer navigates — it edits the cell it landed on');
  assert.match(grid, /class: 'open-link'/, 'the #id link is still the way in');
});

/* ── the skin ──────────────────────────────────────────────────────────── */

test('chips keep their tint and lose their box', () => {
  assert.equal(rulesFor('.wv-grid .chip')['border-color'], 'transparent');
  assert.equal(rulesFor('.wv-grid td.cell-computed').background, 'none',
    'a computed cell stops wearing a tinted box');
});

test("a row's remove and link controls wait for the pointer", () => {
  assert.equal(rulesFor('.wv-grid .chip .x').opacity, '0', 'the × is chrome, not content');
  const shown = rulesFor('.wv-grid tr:hover .chip .x');
  assert.equal(shown.opacity, '1');
  assert.ok(rulesFor('.wv-grid tr:focus-within .chip .x').opacity, 'and the keyboard reveals it too');
});

test('the name column carries the row, so it is set heavier', () => {
  assert.ok(Number.parseFloat(rulesFor('.wv-grid td.name-cell .inline-edit')['font-weight']) >= 600);
  assert.match(APP, /name-cell/, 'the grid marks which column is the name');
});

/* ── density ───────────────────────────────────────────────────────────── */

test('density is a control with two heights, and compact is the shorter one', () => {
  const comfy = rulesFor('.wv-grid');
  const compact = rulesFor('.wv-grid[data-density="compact"]');
  assert.ok(comfy['--wv-row-pad'], 'row height is one variable');
  assert.ok(compact['--wv-row-pad'], 'compact overrides it');
  assert.ok(Number.parseFloat(compact['--wv-row-pad']) < Number.parseFloat(comfy['--wv-row-pad']),
    'compact rows are shorter than comfortable ones');
});

test('a table remembers the density it was last read at', () => {
  assert.match(APP, /function gridDensity\(/);
  const fn = APP.match(/function gridDensity\([^]*?\n\}/)[0];
  assert.match(fn, /localStorage/, 'a viewing preference, per person, per table');
  assert.match(fn, /weave-grid-density:/, 'keyed like the other per-entity view state');
  assert.match(APP, /Comfortable/, 'and it is a visible control, not a hidden setting');
});
