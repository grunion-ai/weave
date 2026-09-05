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

test('the count speaks the table\'s row term, singular at one — the puck says what it holds', () => {
  assert.equal(SEL.countLabel(1), '1 record', 'no term: the default');
  assert.equal(SEL.countLabel(12), '12 records');
  assert.equal(SEL.countLabel(1, { singular: 'deal', plural: 'deals' }), '1 deal');
  assert.equal(SEL.countLabel(3, { singular: 'deal', plural: 'deals' }), '3 deals');
  assert.match(SEL.moreCommands({ term: { singular: 'deal', plural: 'deals' }, relations: ['P'] }).find((c) => c.id === 'rollup').label, /new deal/);
});

/* ---------- the puck (slice 2) ----------
   A command that is designed but not yet built must not reach the bar. An
   icon that does nothing reads as broken, not as forthcoming — so the bar
   carries what this release can actually run, and the rest waits. */
test('the bar carries only what is built, in the designed order', () => {
  const built = ['dup', 'trash'];
  const cmds = SEL.barCommands({ relations: ['Project'], writableFields: ['Name'], built });
  assert.deepEqual(cmds.map((c) => c.id), ['dup', 'trash'],
    'Set a field… and Link to… are designed but unbuilt, so they are absent');
  assert.equal(cmds.at(-1).id, 'trash', 'trash stays last');
});

test('with everything built the bar is the full designed set', () => {
  const all = ['fields', 'link', 'dup', 'more', 'trash'];
  assert.deepEqual(
    SEL.barCommands({ relations: ['P'], writableFields: ['Name'], built: all }).map((c) => c.id),
    all);
});

test('the overflow answers to the same rule, and can be empty', () => {
  assert.deepEqual(SEL.moreCommands({ built: ['copy'] }).map((c) => c.id), ['copy']);
  assert.deepEqual(SEL.moreCommands({ built: [] }), [], 'nothing built, no ⋯');
  assert.deepEqual(SEL.moreCommands({ relations: ['P'] }).map((c) => c.id), ['move', 'rollup', 'copy']);
});

/* ---------- the commands (slice 3) ----------
   The overflow is contextual too: Move to table… needs somewhere to move to,
   Roll up… needs a relation to hang the new parent on, and Copy links always
   has something to copy. When the overflow is empty, the ⋯ itself leaves the
   bar — a button that opens nothing is the dead icon the built rule exists
   to keep off. */
test('the overflow hides Move to table… when this is the only table, and Roll up… without a relation', () => {
  const alone = SEL.moreCommands({ relations: [], otherTables: 0 }).map((c) => c.id);
  assert.deepEqual(alone, ['copy']);
  const full = SEL.moreCommands({ relations: ['Project'], otherTables: 2 }).map((c) => c.id);
  assert.deepEqual(full, ['move', 'rollup', 'copy']);
});

test('an empty overflow takes the ⋯ off the bar', () => {
  const cmds = SEL.barCommands({ writableFields: ['Name'], more: [] }).map((c) => c.id);
  assert.ok(!cmds.includes('more'));
  const withMore = SEL.barCommands({ writableFields: ['Name'], more: [{ id: 'copy' }] }).map((c) => c.id);
  assert.ok(withMore.includes('more'));
});

/* Only fields the bulk editor can give ONE value to reach Set a field…:
   chips, options, a checkbox, a typed value. Relations are Link to…'s,
   documents are prose, and computed fields are reads. */
test('settable fields are the ones a single value fits', () => {
  const fields = [
    { name: 'Name', type: 'text' }, { name: 'Est', type: 'number' }, { name: 'Due', type: 'date' },
    { name: 'Status', type: 'workflow' }, { name: 'Kind', type: 'select' }, { name: 'Tags', type: 'multiselect' },
    { name: 'Done', type: 'checkbox' }, { name: 'Site', type: 'url' }, { name: 'Mail', type: 'email' },
    { name: 'Owner', type: 'relation' }, { name: 'Body', type: 'document' }, { name: 'Total', type: 'rollup' },
    { name: 'Twice', type: 'formula' }, { name: 'Files', type: 'attachments' }, { name: 'Token', type: 'key' },
  ];
  assert.deepEqual(SEL.settableFields(fields).map((f) => f.name),
    ['Name', 'Est', 'Due', 'Status', 'Kind', 'Tags', 'Done', 'Site', 'Mail']);
});

/* The toast after a bulk command says what did NOT land — a half-working
   command that reports success is how a row goes missing quietly. */
test('the bulk toast names failures and what a move left behind', () => {
  const term = { singular: 'task', plural: 'tasks' };
  const ok = SEL.bulkToast({ verb: 'Set', count: 3, term, result: { done: ['a', 'b', 'c'], failed: [] } });
  assert.deepEqual(ok, { msg: 'Set 3 tasks', err: false });
  const bad = SEL.bulkToast({ verb: 'Set', count: 3, term, result: { done: ['a'], failed: [{ id: 'b', error: 'x is not a number' }, { id: 'c', error: 'x is not a number' }] } });
  assert.equal(bad.err, true);
  assert.equal(bad.msg, 'Set: 2 of 3 failed — x is not a number');
  const moved = SEL.bulkToast({ verb: 'Moved', count: 2, term, result: { done: ['a', 'b'], failed: [], moved: [{ skipped: ['Project', 'files'] }, { skipped: ['Project'] }] } });
  assert.deepEqual(moved, { msg: 'Moved 2 tasks — left behind: Project, files', err: false });
});
