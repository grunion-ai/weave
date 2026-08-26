/* Row selection, the pure half (Feature #132, slice 1).
   The five bars study chose the Puck (Kyle, 2026-08-24), but every one of the
   five would have shared this: a set of chosen rows, a checkbox column left of
   the # link, and a header box that reads none / some / all.

   Two rules the mockup settled and this suite pins:
     1. The checkbox column sits to the LEFT of the # link, so the link never
        disappears while a selection is live. That is a DOM fact — the browser
        suite owns it. What lives here is the arithmetic underneath.
     2. Selection is a set of ids, never a set of row indices. A redraw sorts,
        filters and re-numbers the rows; a selection keyed on position would
        silently move to different rows. `prune` is the other half of that:
        an id that is no longer on the page is no longer selected.

   Ledger's one rule (2026-08-24) forces one departure from the mockup: a bare
   row click raises that cell's editor, so it CANNOT also toggle selection.
   The checkbox is the only way in, and shift extends from the last box hit. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/selection-core.js');
const SEL = globalThis.WeaveSelection;

test('toggle adds an unselected id and removes a selected one', () => {
  const a = SEL.toggle(new Set(), 'x');
  assert.deepEqual([...a], ['x']);
  assert.deepEqual([...SEL.toggle(a, 'x')], []);
});

test('toggle returns a NEW set, so a redraw cannot mutate the live one', () => {
  const before = new Set(['x']);
  const after = SEL.toggle(before, 'y');
  assert.deepEqual([...before], ['x'], 'the original is untouched');
  assert.deepEqual([...after].sort(), ['x', 'y']);
});

test('headState reads none, some and all — the indeterminate box', () => {
  assert.equal(SEL.headState(0, 5), 'none');
  assert.equal(SEL.headState(2, 5), 'some');
  assert.equal(SEL.headState(5, 5), 'all');
  // An empty table has nothing to select, so its box is not "all".
  assert.equal(SEL.headState(0, 0), 'none');
});

test('range spans the two ids in the order the rows are DRAWN, either way round', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(SEL.range(rows, 'b', 'd'), ['b', 'c', 'd']);
  // Shift-clicking upward is the same span. A range that only ran forwards
  // would select nothing every time the reader picked the lower row first.
  assert.deepEqual(SEL.range(rows, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(SEL.range(rows, 'c', 'c'), ['c']);
});

test('range is empty when either end is no longer on the page', () => {
  assert.deepEqual(SEL.range(['a', 'b'], 'gone', 'b'), []);
  assert.deepEqual(SEL.range(['a', 'b'], 'a', 'gone'), []);
});

test('range follows the SORTED order, not the order the rows arrived in', () => {
  // The grid sorts in place before it draws. Shift-click means "everything
  // between these two rows on screen", which is the sorted span.
  const drawn = ['e', 'd', 'c', 'b', 'a'];
  assert.deepEqual(SEL.range(drawn, 'd', 'b'), ['d', 'c', 'b']);
});

test('prune drops ids that are no longer drawn and keeps the rest', () => {
  const kept = SEL.prune(new Set(['a', 'b', 'gone']), ['a', 'b', 'c']);
  assert.deepEqual([...kept].sort(), ['a', 'b']);
});

test('prune of an empty selection stays empty rather than selecting the page', () => {
  assert.deepEqual([...SEL.prune(new Set(), ['a', 'b'])], []);
});

test('selectAll takes the drawn ids, and clearing takes none of them', () => {
  assert.deepEqual([...SEL.selectAll(['a', 'b', 'c'])].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...SEL.selectAll([])], []);
});

/* The bar is contextual: a table with no relations gets no "Link to…", and
   the commands that write a field need a field that can be written. Computed
   types cannot, so they never reach the picker. */
test('the bar hides Link to… on a table with no relations', () => {
  const none = SEL.barCommands({ relations: [], writableFields: ['Name'] }).map((c) => c.id);
  assert.ok(!none.includes('link'), 'no relation, no link command');
  const some = SEL.barCommands({ relations: ['Project'], writableFields: ['Name'] }).map((c) => c.id);
  assert.ok(some.includes('link'));
});

test('the bar hides Set a field… when nothing on the table can be written', () => {
  const cmds = SEL.barCommands({ relations: [], writableFields: [] }).map((c) => c.id);
  assert.ok(!cmds.includes('fields'));
  // Duplicate and trash never depend on the schema, so they always survive.
  assert.ok(cmds.includes('dup'));
  assert.ok(cmds.includes('trash'));
});

test('trash is last, and it is the only destructive command on the bar', () => {
  const cmds = SEL.barCommands({ relations: ['P'], writableFields: ['Name'] });
  assert.equal(cmds.at(-1).id, 'trash');
  assert.deepEqual(cmds.filter((c) => c.danger).map((c) => c.id), ['trash']);
});

test('the count reads as rows, singular at one — the puck says what it holds', () => {
  assert.equal(SEL.countLabel(1), '1 row');
  assert.equal(SEL.countLabel(12), '12 rows');
});
