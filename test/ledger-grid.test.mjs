import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, rulesFor } from './lib/source.mjs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;

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
  assert.match(fn, /input\.select\(\)/, 'focusing a text cell selects its whole value (Feature #221)');
  assert.match(fn, /chip-trigger|ms-box/, 'a picker cell opens its picker');
  assert.match(fn, /checked|\.click\(\)/, 'a checkbox cell toggles');
  assert.match(APP, /dataset:\s*\{[^}]*ftype/, 'each cell carries its field type for the dispatch');
});

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

test('a clipped cell draws no floating marker glyph', () => {
  assert.deepEqual(rulesFor('.wv-grid td.clipped::after'), {},
    'Kyle, 2026-09-27: the floating micro icon is not needed; hover still opens the whole value');
  assert.match(APP, /scrollWidth\s*>\s*[\w.]+\.clientWidth/, 'clipped is measured, never assumed');
});

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

test('the id link docks the entity, ⌘-click opens a tab, and the row itself does neither', () => {
  const grid = APP.match(/function renderTable\([^]*?\n\}\n/)[0];
  assert.match(grid, /dataset: \{ eid: item\.id, href: registryHref\(db, item\) \?\? `#\/entity\/\$\{item\.id\}` \}/,
    'the row declares where it goes, and openNativeClick turns a ⌘-click into that tab (Issue #134)');
  assert.match(grid, /dockEntity\(db, item\.id, \{ step: true \}\)/,
    'the #id link docks the entity beside the table');
  assert.ok(!/if \(openRegistryRow\(db, item\)\) return;\s*\n\s*openEntity\(item\.id\);/.test(grid),
    'a bare row click no longer navigates — it edits the cell it landed on');
  assert.match(grid, /class: 'open-link'/, 'the #id link is still the way in');
});

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

test('density is a control with three declared heights, compact the shortest and spacious the tallest', () => {
  const px = (sel) => Number.parseFloat(rulesFor(sel)['--wv-row-h']);
  assert.equal(px('.wv-grid'), 44, 'Comfortable is the default (Feature #239)');
  assert.equal(px('.wv-grid[data-density="compact"]'), 32);
  assert.equal(px('.wv-grid[data-density="spacious"]'), 72);
});

test('a table view remembers the density it was last read at (Feature #239)', () => {
  assert.match(APP, /function gridDensity\(/);
  const fn = APP.match(/function gridDensity\([^]*?\n\}/)[0];
  assert.match(fn, /db\.view\.density/, 'the view carries it');
  assert.match(APP, /density: mode/, 'and a pick autosaves into the view');
  assert.match(APP, /Spacious/, 'and it is a visible control, not a hidden setting');
});

test('every value surface in the grid is set at one size, and it is the chip size', () => {
  const root = rulesFor(':root');
  assert.equal(root['--wv-grid-font'], 'var(--wv-chip-font)', 'the grid size IS the chip size');
  for (const sel of ['.wv-grid tbody td', '.wv-grid tbody .inline-edit', '.wv-grid .num-dressed',
    '.wv-grid .text-dressed', '.wv-grid td.sys-cell']) {
    assert.equal(rulesFor(sel)['font-size'], 'var(--wv-grid-font)', `${sel} reads the grid token`);
  }
  assert.equal(root['--wv-grid-line'], '20px', 'a whole-pixel line, so a row height is a whole pixel');
  for (const sel of ['.wv-grid tbody td', '.wv-grid tbody .inline-edit']) {
    assert.equal(rulesFor(sel)['line-height'], 'var(--wv-grid-line)', `${sel} reads the line token`);
  }
  assert.equal(rulesFor('.wv-grid tbody .inline-edit')['font-family'], 'inherit',
    'a control at rest wears the grid face, not the form face');
  const name = rulesFor('.wv-grid td.name-cell .inline-edit');
  assert.equal(name['font-size'], undefined, 'the name column is heavier, never larger');
});
