/* Grid ranges — the pure half (Feature #220).

   Kyle, 2026-09-09: "I need a better way to select, drag to duplicate, copy
   or paste values — like single or multi select dropdowns — across cells."

   #134 made the cell rest as a value and #132 gave a selection of ROWS one
   write (`bulk`). This is the rectangle between them: a range of cells, the
   fill that drags one value across it, and the clipboard that carries typed
   values rather than strings. No DOM here — a rectangle, a block of cells
   and a table's field types resolve to the writes `bulk set` will make and
   the field names that refused them.

   The DOM half (drag, the handle, ⌘C/⌘V) is pinned in
   test/grid-range-browser.test.mjs; the ⇧-arrow half of the keymap in
   test/grid-keymap.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/selection-core.js');
await import('../public/grid-range.js');
const R = globalThis.WeaveGridRange;

/* A table to plan against: three columns the grid can write, one it cannot. */
const FIELDS = {
  Name: { type: 'text' },
  Kind: { type: 'select', options: [{ id: 'o-bug', name: 'bug' }, { id: 'o-chore', name: 'chore' }] },
  Tags: { type: 'multiselect', options: [{ id: 't-a', name: 'a' }, { id: 't-b', name: 'b' }] },
  Done: { type: 'checkbox' },
  Score: { type: 'number' },
  Total: { type: 'formula' },
};
const typeOf = (n) => FIELDS[n]?.type ?? null;
const optionsOf = (n) => FIELDS[n]?.options ?? [];
const cols = ['Name', 'Kind', 'Tags', 'Done', 'Score', 'Total'];
const rowIds = ['e1', 'e2', 'e3', 'e4'];
const ctx = { fields: cols, rowIds, typeOf, optionsOf };

/* ── the rectangle ─────────────────────────────────────────────────────── */

test('a rectangle is the two corners in either order', () => {
  assert.deepEqual(R.rect({ r: 2, c: 3 }, { r: 0, c: 1 }), { r0: 0, c0: 1, r1: 2, c1: 3 });
  assert.deepEqual(R.rect({ r: 0, c: 1 }, { r: 2, c: 3 }), { r0: 0, c0: 1, r1: 2, c1: 3 });
  assert.deepEqual(R.size(R.rect({ r: 0, c: 1 }, { r: 2, c: 3 })), { h: 3, w: 3 });
});

test('one cell is a range of one — the resting cursor is the smallest range there is', () => {
  const one = R.rect({ r: 1, c: 1 }, { r: 1, c: 1 });
  assert.deepEqual(R.size(one), { h: 1, w: 1 });
  assert.equal(R.single(one), true);
  assert.equal(R.single(R.rect({ r: 1, c: 1 }, { r: 2, c: 1 })), false);
});

test('the cells of a rectangle come out row-major — the order a spreadsheet reads', () => {
  assert.deepEqual(R.cellsOf({ r0: 0, c0: 0, r1: 1, c1: 1 }),
    [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }]);
});

test('has() answers for a cell inside and outside', () => {
  const rect = { r0: 1, c0: 1, r1: 2, c1: 2 };
  assert.equal(R.has(rect, 1, 2), true);
  assert.equal(R.has(rect, 0, 1), false);
  assert.equal(R.has(rect, 2, 3), false);
});

/* ── ⇧-arrows grow it; the anchor holds ────────────────────────────────── */

test('⇧-arrow moves the focus and leaves the anchor where it was', () => {
  const out = R.extend({ anchor: { r: 1, c: 1 }, focus: { r: 1, c: 1 }, dr: 1, dc: 0, rows: 4, cols: 6 });
  assert.deepEqual(out, { anchor: { r: 1, c: 1 }, focus: { r: 2, c: 1 } });
  const back = R.extend({ ...out, dr: -1, dc: 0, rows: 4, cols: 6 });
  assert.deepEqual(back.focus, { r: 1, c: 1 }, 'walking back toward the anchor shrinks the range again');
});

test('no anchor yet: the cell you are on becomes it', () => {
  const out = R.extend({ anchor: null, focus: { r: 0, c: 2 }, dr: 0, dc: 1, rows: 4, cols: 6 });
  assert.deepEqual(out.anchor, { r: 0, c: 2 });
  assert.deepEqual(out.focus, { r: 0, c: 3 });
});

test('⇧-arrow at the edge holds rather than leaking out of the grid', () => {
  assert.equal(R.extend({ anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, dr: -1, dc: 0, rows: 4, cols: 6 }), null);
  assert.equal(R.extend({ anchor: { r: 3, c: 5 }, focus: { r: 3, c: 5 }, dr: 0, dc: 1, rows: 4, cols: 6 }), null);
});

/* ── what a copy carries ───────────────────────────────────────────────── */

const valueAt = (r, c) => {
  const grid = [
    { Name: 'first', Kind: { v: 'o-bug', d: 'bug' }, Tags: { v: ['t-a', 't-b'], d: ['a', 'b'] }, Done: { v: true, d: true }, Score: 1, Total: 9 },
    { Name: 'second', Kind: { v: 'o-chore', d: 'chore' }, Tags: { v: [], d: [] }, Done: { v: false, d: false }, Score: 2, Total: 8 },
    { Name: 'third', Kind: { v: null, d: null }, Tags: { v: [], d: [] }, Done: { v: false, d: false }, Score: 3, Total: 7 },
    { Name: 'fourth', Kind: { v: null, d: null }, Tags: { v: [], d: [] }, Done: { v: false, d: false }, Score: 4, Total: 6 },
  ];
  const raw = grid[r][cols[c]];
  const cell = raw && typeof raw === 'object' ? raw : { v: raw, d: raw };
  return { type: typeOf(cols[c]), v: cell.v, d: cell.d };
};

test('a block carries the field it came from and the typed value, not the label', () => {
  const b = R.block({ rect: { r0: 0, c0: 1, r1: 0, c1: 2 }, fields: cols, valueAt });
  assert.deepEqual(b.fields, ['Kind', 'Tags']);
  assert.deepEqual(b.cells[0][0], { type: 'select', v: 'o-bug', d: 'bug' });
  assert.deepEqual(b.cells[0][1].v, ['t-a', 't-b'], 'a multi-select cell copies the whole set');
  assert.deepEqual(R.size(b), { h: 1, w: 2 });
});

test('the same block reads as TSV for anything outside weave', () => {
  const b = R.block({ rect: { r0: 0, c0: 0, r1: 1, c1: 2 }, fields: cols, valueAt });
  assert.equal(R.toTSV(b), 'first\tbug\ta, b\nsecond\tchore\t');
});

test('TSV from a spreadsheet parses row-major into an untyped block', () => {
  const b = R.parseTSV('x\ty\nz\tw\n');
  assert.deepEqual(R.size(b), { h: 2, w: 2 });
  assert.equal(b.fields, null, 'text from outside weave names no fields');
  assert.deepEqual(b.cells[1], [{ type: null, v: 'z', d: 'z' }, { type: null, v: 'w', d: 'w' }]);
  assert.deepEqual(R.size(R.parseTSV('a\r\nb\r\n')), { h: 2, w: 1 }, 'CRLF is one line ending');
});

test('empty text is no block at all rather than a block of one blank', () => {
  assert.equal(R.parseTSV(''), null);
  assert.equal(R.parseTSV('   \n  '), null);
});

/* ── where a paste lands ───────────────────────────────────────────────── */

test('a paste onto one cell takes the block’s own shape from there', () => {
  const b = R.parseTSV('a\tb\nc\td');
  assert.deepEqual(R.target({ rect: { r0: 1, c0: 1, r1: 1, c1: 1 }, block: b, rows: 4, cols: 6 }),
    { r0: 1, c0: 1, r1: 2, c1: 2 });
});

test('a paste onto a range fills the range — the block tiles to cover it', () => {
  const b = R.parseTSV('a\tb');
  const rect = { r0: 0, c0: 0, r1: 2, c1: 3 };
  assert.deepEqual(R.target({ rect, block: b, rows: 4, cols: 6 }), rect);
});

test('a paste that would run off the grid is clipped at the last row and column', () => {
  const b = R.parseTSV('a\tb\tc\nd\te\tf');
  assert.deepEqual(R.target({ rect: { r0: 3, c0: 5, r1: 3, c1: 5 }, block: b, rows: 4, cols: 6 }),
    { r0: 3, c0: 5, r1: 3, c1: 5 });
});

test('tiling repeats the block across a wider target, row-major', () => {
  const b = R.parseTSV('a\tb');
  assert.equal(R.at(b, 0, 0).v, 'a');
  assert.equal(R.at(b, 0, 1).v, 'b');
  assert.equal(R.at(b, 0, 2).v, 'a', 'the block repeats rather than running out');
  assert.equal(R.at(b, 3, 5).v, 'b');
});

/* ── the fill handle ───────────────────────────────────────────────────── */

test('the handle drags down or across, whichever it moved further', () => {
  const rect = { r0: 0, c0: 0, r1: 0, c1: 0 };
  assert.deepEqual(R.fillTarget(rect, { r: 3, c: 1 }), { r0: 0, c0: 0, r1: 3, c1: 0 }, 'down');
  assert.deepEqual(R.fillTarget(rect, { r: 1, c: 3 }), { r0: 0, c0: 0, r1: 0, c1: 3 }, 'across');
});

test('the handle dragged back into the range, or up and left of it, fills nothing', () => {
  const rect = { r0: 1, c0: 1, r1: 2, c1: 2 };
  assert.equal(R.fillTarget(rect, { r: 2, c: 2 }), null);
  assert.equal(R.fillTarget(rect, { r: 0, c: 0 }), null);
});

/* ── the plan: what bulk will write, and what refused ──────────────────── */

test('a fill of a select column down four rows writes the option ID four times', () => {
  const b = R.block({ rect: { r0: 0, c0: 1, r1: 0, c1: 1 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 1, r1: 3, c1: 1 }, ...ctx });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.writes.length, 4);
  assert.ok(plan.writes.every((w) => w.field === 'Kind' && w.value === 'o-bug'),
    'the option id carries over whole — paste is by identity, not by label');
  assert.deepEqual(plan.writes.map((w) => w.eid), rowIds);
});

test('an identical fill is ONE bulk call, so ⌘Z takes the whole thing back', () => {
  const b = R.block({ rect: { r0: 0, c0: 1, r1: 0, c1: 1 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 1, r1: 3, c1: 1 }, ...ctx });
  const groups = R.group(plan.writes);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], { ids: rowIds, values: { Kind: 'o-bug' } });
});

test('a paste of different values per row is one call per distinct value set', () => {
  const b = R.parseTSV('bug\nchore\nbug');
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 1, r1: 2, c1: 1 }, ...ctx });
  const groups = R.group(plan.writes);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.values.Kind === 'bug').ids, ['e1', 'e3']);
});

test('a multi-select pastes as a replacement, never a merge', () => {
  const b = R.block({ rect: { r0: 0, c0: 2, r1: 0, c1: 2 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 1, c0: 2, r1: 3, c1: 2 }, ...ctx });
  assert.equal(plan.writes.length, 3);
  for (const w of plan.writes) assert.deepEqual(w.value, ['t-a', 't-b'], 'the whole set, as it stood');
});

test('a formula column refuses the paste and is named — the bulk precedent', () => {
  const b = R.block({ rect: { r0: 0, c0: 0, r1: 0, c1: 0 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 5, r1: 2, c1: 5 }, ...ctx });
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.refused, ['Total']);
});

test('a refusal takes only its own column: the rest of the block still lands', () => {
  // Score (number) then Total (formula), side by side.
  const plan = R.plan({ block: R.parseTSV('1\tx\n2\ty'), rect: { r0: 0, c0: 4, r1: 1, c1: 5 }, ...ctx });
  assert.deepEqual(plan.refused, ['Total']);
  assert.deepEqual(plan.writes.map((w) => [w.eid, w.field, w.value]),
    [['e1', 'Score', 1], ['e2', 'Score', 2]]);
});

test('every unwritable type refuses, and the pasteable list is the settable one', () => {
  assert.deepEqual(R.PASTEABLE, globalThis.WeaveSelection.SETTABLE,
    'one list: what Set a field… offers is what a paste can land on');
  for (const t of ['formula', 'rollup', 'lookup', 'view', 'document', 'attachments', 'key', 'field']) {
    assert.equal(R.pasteable(t), false, `${t} is not a paste target`);
  }
  assert.equal(R.pasteable('relation'), false, 'a relation is not a Set a field… target; the plan admits it only with rows to match (Feature #224)');
  for (const t of ['text', 'number', 'select', 'multiselect', 'workflow', 'checkbox']) {
    assert.equal(R.pasteable(t), true);
  }
});

/* ── the rules the types force ─────────────────────────────────────────── */

test('a select id that the target field does not hold falls back to the label', () => {
  // A block copied from another table: the option id is a stranger here.
  const far = { fields: ['Kind'], w: 1, h: 1, cells: [[{ type: 'select', v: 'far-id', d: 'chore' }]] };
  const plan = R.plan({ block: far, rect: { r0: 0, c0: 1, r1: 0, c1: 1 }, ...ctx });
  assert.equal(plan.writes[0].value, 'chore', 'matched on label, for the engine to resolve or refuse');
});

test('a label the target field does not have is passed on to be refused, never invented', () => {
  const far = { fields: ['Kind'], w: 1, h: 1, cells: [[{ type: 'select', v: 'far-id', d: 'epic' }]] };
  const plan = R.plan({ block: far, rect: { r0: 0, c0: 1, r1: 0, c1: 1 }, ...ctx });
  assert.equal(plan.writes[0].value, 'epic', 'the engine says “not an option of Kind”; the grid does not guess');
});

test('a multi-select from another table resolves member by member', () => {
  const far = { fields: ['Tags'], w: 1, h: 1, cells: [[{ type: 'multiselect', v: ['t-a', 'far-id'], d: ['a', 'b'] }]] };
  const plan = R.plan({ block: far, rect: { r0: 0, c0: 2, r1: 0, c1: 2 }, ...ctx });
  assert.deepEqual(plan.writes[0].value, ['t-a', 'b'], 'the id we hold, the label for the one we do not');
});

test('text into a multi-select splits on commas — the shape the TSV came out in', () => {
  const b = R.parseTSV('a, b');
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 2, r1: 0, c1: 2 }, ...ctx });
  assert.deepEqual(plan.writes[0].value, ['a', 'b']);
  const empty = R.plan({ block: R.parseTSV('-'), rect: { r0: 0, c0: 2, r1: 0, c1: 2 }, ...ctx });
  assert.deepEqual(empty.writes[0].value, ['-']);
});

test('text into a checkbox is read, not coerced — “false” is false, and a stranger is unparseable', () => {
  const on = R.plan({ block: R.parseTSV('true'), rect: { r0: 0, c0: 3, r1: 0, c1: 3 }, ...ctx });
  assert.equal(on.writes[0].value, true);
  const off = R.plan({ block: R.parseTSV('false'), rect: { r0: 0, c0: 3, r1: 0, c1: 3 }, ...ctx });
  assert.equal(off.writes[0].value, false, 'Boolean("false") is true; the grid does not make that mistake');
  const bad = R.plan({ block: R.parseTSV('maybe'), rect: { r0: 0, c0: 3, r1: 0, c1: 3 }, ...ctx });
  assert.deepEqual(bad.writes, []);
  assert.equal(bad.unparsed, 1);
});

test('text into a number is parsed, and only the unparseable cell is dropped', () => {
  const plan = R.plan({ block: R.parseTSV('12\nnope\n3.5'), rect: { r0: 0, c0: 4, r1: 2, c1: 4 }, ...ctx });
  assert.deepEqual(plan.writes.map((w) => w.value), [12, 3.5]);
  assert.equal(plan.unparsed, 1);
  assert.deepEqual(plan.writes.map((w) => w.eid), ['e1', 'e3']);
});

test('a typed copy stays typed: a checkbox carries its boolean, not its label', () => {
  const b = R.block({ rect: { r0: 0, c0: 3, r1: 0, c1: 3 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 1, c0: 3, r1: 1, c1: 3 }, ...ctx });
  assert.equal(plan.writes[0].value, true);
});

test('an empty cell pastes as empty rather than as the string “null”', () => {
  const b = R.block({ rect: { r0: 2, c0: 1, r1: 2, c1: 1 }, fields: cols, valueAt });
  const plan = R.plan({ block: b, rect: { r0: 0, c0: 1, r1: 0, c1: 1 }, ...ctx });
  assert.equal(plan.writes[0].value, null);
});

/* ── what the toast says ───────────────────────────────────────────────── */

test('the toast counts the cells that landed and names every column that refused', () => {
  const t = R.toast({ verb: 'Pasted', cells: 6, refused: ['Total'], unparsed: 0, results: [{ done: ['a', 'b'], failed: [] }] });
  assert.equal(t.err, false);
  assert.match(t.msg, /Pasted 6 cells/);
  assert.match(t.msg, /Total/, 'the refused column is named, not counted');
});

test('a failure is what the toast leads with — a half-landed write is how a value goes missing', () => {
  const t = R.toast({ verb: 'Filled', cells: 4, refused: [], unparsed: 0, results: [{ done: [], failed: [{ id: 'a', error: "'epic' is not an option of 'Kind'" }] }] });
  assert.equal(t.err, true);
  assert.match(t.msg, /not an option of 'Kind'/);
});

test('unparseable cells are counted, since there is no column to name', () => {
  const t = R.toast({ verb: 'Pasted', cells: 3, refused: [], unparsed: 2, results: [{ done: ['a'], failed: [] }] });
  assert.match(t.msg, /2 unreadable/);
});

test('nothing to write says so instead of claiming a paste', () => {
  const t = R.toast({ verb: 'Pasted', cells: 0, refused: ['Total'], unparsed: 0, results: [] });
  assert.equal(t.err, true);
  assert.match(t.msg, /Nothing pasted/);
  assert.match(t.msg, /Total/);
});

/* ── a relation links by name (Feature #224) ───────────────────────────── */

const PEOPLE = [
  { id: 'p-ann', name: 'Ann', publicId: 1 },
  { id: 'p-bob', name: 'Bob', publicId: 2 },
  { id: 'p-cy', name: 'Cy Ng', publicId: 3 },
];
const REL = {
  ...FIELDS,
  Peers: { type: 'relation', many: true },
  Owner: { type: 'relation', many: false },
};
const relCols = [...cols, 'Peers', 'Owner'];
const relCtx = {
  fields: relCols, rowIds,
  typeOf: (n) => REL[n]?.type ?? null,
  optionsOf: (n) => REL[n]?.options ?? [],
  relationOf: (n) => (REL[n]?.type === 'relation' ? { rows: PEOPLE, many: REL[n].many } : null),
};
const PEERS = 6, OWNER = 7;

test('resolveRelation: an id we hold wins, then the exact name, then #id — and the strangers are named', () => {
  const out = R.resolveRelation({ ids: ['p-ann', 'far-id', 'x', 'y'], labels: ['Zed', ' bob ', '#3', 'Nobody'], rows: PEOPLE, many: true });
  assert.deepEqual(out.ids, ['p-ann', 'p-bob', 'p-cy'], 'id first, then the trimmed case-insensitive name, then the public id');
  assert.deepEqual(out.unmatched, ['Nobody']);
});

test('resolveRelation: a single-cardinality field takes the first match, and a set never repeats a row', () => {
  assert.deepEqual(R.resolveRelation({ labels: ['Bob', 'Ann'], rows: PEOPLE, many: false }).ids, ['p-bob']);
  assert.deepEqual(R.resolveRelation({ labels: ['Ann', 'ann', '#1'], rows: PEOPLE, many: true }).ids, ['p-ann']);
});

test('a relation cell copied inside weave pastes its ids whole — the same replacement rule a multi-select has', () => {
  const b = { fields: ['Peers'], w: 1, h: 1, cells: [[{ type: 'relation', v: ['p-ann', 'p-cy'], d: ['Ann', 'Cy Ng'] }]] };
  const plan = R.plan({ block: b, rect: { r0: 0, c0: PEERS, r1: 2, c1: PEERS }, ...relCtx });
  assert.deepEqual(plan.refused, []);
  assert.equal(plan.writes.length, 3);
  for (const w of plan.writes) assert.deepEqual(w.value, ['p-ann', 'p-cy']);
  assert.deepEqual(plan.unmatched, []);
});

test('text into a relation links by name, and the label that names no row is counted and named', () => {
  const plan = R.plan({ block: R.parseTSV('Ann, Nobody'), rect: { r0: 0, c0: PEERS, r1: 0, c1: PEERS }, ...relCtx });
  assert.deepEqual(plan.writes[0].value, ['p-ann'], 'the known name links');
  assert.deepEqual(plan.unmatched, ['Nobody']);
  assert.equal(plan.unparsed, 0, 'the cell landed, so it is not an unreadable cell');
});

test('a relation cell whose labels all miss is dropped rather than emptied', () => {
  const plan = R.plan({ block: R.parseTSV('Nobody\nAnn'), rect: { r0: 0, c0: PEERS, r1: 1, c1: PEERS }, ...relCtx });
  assert.deepEqual(plan.writes.map((w) => [w.eid, w.value]), [['e2', ['p-ann']]]);
  assert.equal(plan.unparsed, 1);
  assert.deepEqual(plan.unmatched, ['Nobody']);
});

test('an empty cell pasted into a relation clears it; a single relation takes one id, not a list', () => {
  const b = { fields: ['Peers'], w: 1, h: 2, cells: [[{ type: 'relation', v: [], d: [] }], [{ type: 'relation', v: ['p-bob', 'p-ann'], d: ['Bob', 'Ann'] }]] };
  const plan = R.plan({ block: b, rect: { r0: 0, c0: OWNER, r1: 1, c1: OWNER }, ...relCtx });
  assert.deepEqual(plan.writes.map((w) => w.value), [null, 'p-bob']);
});

test('a relation whose rows are not to hand still refuses by name — nothing is guessed', () => {
  const plan = R.plan({ block: R.parseTSV('Ann'), rect: { r0: 0, c0: PEERS, r1: 0, c1: PEERS }, ...relCtx, relationOf: () => null });
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.refused, ['Peers']);
});

test('the toast names the labels that matched no row', () => {
  const t = R.toast({ verb: 'Pasted', cells: 1, unmatched: ['Nobody', 'Ghost'], results: [{ done: ['a'], failed: [] }] });
  assert.equal(t.err, false);
  assert.match(t.msg, /2 unmatched \(Nobody, Ghost\)/);
});
