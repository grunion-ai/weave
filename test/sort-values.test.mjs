/* A sort orders the value, never its costume (Issue #279).

   uno's Agent/Sessions grid — 720 rows, sorted Created descending, Created a
   `date` field wearing the `long` format — put "Sep 9, 2026 9:51 AM" above
   every row created on Sep 12: the comparator was handed the painted string,
   and "Sep 9" beats "Sep 12" as text. The same defect ordered `$17.25` above
   `$9.50` and `15,829,984` below `900`.

   The rule is the one a formula already reads by (#resolve): a number stays a
   number, a date stays its stored instant, and everything else — joined
   relations, a multiselect's names — sorts by what the reader sees, because
   that IS its value. A select and a workflow are the exception since Issue
   #318: they sort by where the option or state sits in the definition. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Agent' });
  const t = w.createTable({ space: 'Agent', name: 'Session' });
  w.addField(t, { name: 'Created', type: 'date', config: { format: 'long', time: true } });
  w.addField(t, { name: 'Cache Read', type: 'number', config: { separator: true } });
  w.addField(t, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD' } });
  w.addField(t, { name: 'Stage', type: 'select', config: { options: ['alpha', 'beta', 'gamma'] } });
  w.addField(t, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  return { w, t };
}
const names = (res) => res.items.map((i) => i.name);

test('a date column sorts by its instant, not by the month name it paints', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'sep-09', values: { Created: '2026-09-09T09:51' } });
  w.createEntity(t, { name: 'sep-12', values: { Created: '2026-09-12T07:32' } });
  w.createEntity(t, { name: 'oct-01', values: { Created: '2026-10-01T00:05' } });
  // The costume is what made this fail: "Sep 9, …" > "Sep 12, …" > "Oct 1, …"
  // as text, so descending read sep-09, sep-12, oct-01 — exactly backwards.
  assert.equal(w.readEntity(w.query(t, {}).items[0].id).fields.Created.startsWith('Sep'), true, 'the cells still wear the long format');
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Created', dir: 'desc' }] })), ['oct-01', 'sep-12', 'sep-09']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Created' }] })), ['sep-09', 'sep-12', 'oct-01']);
});

test('a number column sorts by the number, through its separators and its currency', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'small', values: { 'Cache Read': 900, Cost: 9.5 } });
  w.createEntity(t, { name: 'large', values: { 'Cache Read': 15829984, Cost: 17.25 } });
  w.createEntity(t, { name: 'mid', values: { 'Cache Read': 2048, Cost: 100 } });
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Cache Read' }] })), ['small', 'mid', 'large']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Cost', dir: 'desc' }] })), ['mid', 'large', 'small']);
});

test('a daterange column sorts by its start, then by its end (Issue #287)', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'sep-09', values: { Window: { start: '2026-09-09', end: '2026-09-12' } } });
  w.createEntity(t, { name: 'oct-01', values: { Window: { start: '2026-10-01', end: '2026-10-03' } } });
  // Two spans that open on the same day: the end breaks the tie, so the
  // shorter one comes first, the way a calendar stacks them.
  w.createEntity(t, { name: 'sep-09-long', values: { Window: { start: '2026-09-09', end: '2026-09-30' } } });
  assert.equal(w.readEntity(w.query(t, {}).items[0].id).fields.Window, 'Sep 9 – Sep 12, 2026', 'the cells still wear the long format');
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Window' }] })), ['sep-09', 'sep-09-long', 'oct-01']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Window', dir: 'desc' }] })), ['oct-01', 'sep-09-long', 'sep-09']);
});

test('a daterange of clock times sorts by the clock, and an empty range still sorts last', () => {
  const { w, t } = build();
  w.addField(t, { name: 'Hours', type: 'daterange', config: { grain: [], time: true, clock: '12h' } });
  w.createEntity(t, { name: 'evening', values: { Hours: { start: '17:40', end: '23:00' } } });
  w.createEntity(t, { name: 'morning', values: { Hours: { start: '09:15', end: '12:00' } } });
  w.createEntity(t, { name: 'none' });
  // "5:40 PM" beats "9:15 AM" as text; 17:40 does not beat 09:15 as a clock.
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Hours' }] })), ['morning', 'evening', 'none']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Hours', dir: 'desc' }] })), ['evening', 'morning', 'none']);
});

test('half a range is still refused, so an open end is only ever imported data', () => {
  const { w, t } = build();
  // The rule for one all the same (an open range extends furthest, so it
  // sorts after a closed one that opens on the same day): importJSON writes
  // state verbatim, and a hand-built file can carry a null end.
  assert.throws(() => w.createEntity(t, { name: 'half', values: { Window: { start: '2026-09-09', end: null } } }), /needs valid start and end/);
  w.createEntity(t, { name: 'closed', values: { Window: { start: '2026-09-09', end: '2026-09-12' } } });
  const open = w.createEntity(t, { name: 'open', values: { Window: { start: '2026-09-09', end: '2026-09-30' } } });
  const state = w.exportJSON({ blobs: false });
  state.entities[open.id].values[w.findField(w.getTable(t), 'Window').id].end = null;
  w.importJSON(state);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Window' }] })), ['closed', 'open']);
});

test('a select sorts by its option, not by the id it stores', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'g', values: { Stage: 'gamma' } });
  w.createEntity(t, { name: 'a', values: { Stage: 'alpha' } });
  w.createEntity(t, { name: 'b', values: { Stage: 'beta' } });
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Stage' }] })), ['a', 'b', 'g']);
});

test('an empty cell sorts last in either direction, as before', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'has', values: { Created: '2026-09-12T07:32' } });
  w.createEntity(t, { name: 'none' });
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Created' }] })), ['has', 'none']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Created', dir: 'desc' }] })), ['has', 'none']);
});

test('a filter still reads the costume: `contains "Sep"` finds the painted month', () => {
  const { w, t } = build();
  w.createEntity(t, { name: 'sep', values: { Created: '2026-09-12T07:32' } });
  w.createEntity(t, { name: 'oct', values: { Created: '2026-10-01T00:05' } });
  assert.deepEqual(names(w.query(t, { where: [['Created', 'contains', 'Sep']] })), ['sep']);
});

/* ---------- Issues #254, #273 and #318: sorting reads the field ----------
   Kyle, 2026-09-09: "sort should just be by ascending descending. but also
   largest smallest most recent to oldest or alphabetical." The stored
   direction stays `asc` / `desc`; what moved is what a status and a select
   order by (the order their definition lists them in, 2026-09-18), and which
   columns may sort at all (the system columns, 2026-09-12). */

function planning() {
  const w = new Weave();
  w.createSpace({ name: 'Plan' });
  const t = w.createTable({ space: 'Plan', name: 'Item' });
  // Definition order is deliberately NOT alphabetical, so a name sort and an
  // option-order sort cannot pass for each other.
  w.addField(t, { name: 'When', type: 'select', config: { options: ['Now', 'Next', 'Later'] } });
  w.addField(t, { name: 'Tags', type: 'multiselect', config: { options: ['zeta', 'alpha', 'mid'] } });
  w.addField(t, {
    name: 'State', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'Doing', category: 'in-progress' },
        { name: 'Closed', category: 'done' },
      ],
    },
  });
  return { w, t };
}

test('a select sorts in the order its options are defined, and descending reverses it (Issue #318)', () => {
  const { w, t } = planning();
  w.createEntity(t, { name: 'later', values: { When: 'Later' } });
  w.createEntity(t, { name: 'now', values: { When: 'Now' } });
  w.createEntity(t, { name: 'next', values: { When: 'Next' } });
  w.createEntity(t, { name: 'unset' });
  // By name this read later, next, now: "L" < "N".
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'When' }] })), ['now', 'next', 'later', 'unset']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'When', dir: 'desc' }] })), ['later', 'next', 'now', 'unset'],
    'reversed, and the empty cell still last');
});

test('a workflow sorts in the order its states are defined (Issue #318)', () => {
  const { w, t } = planning();
  const closed = w.createEntity(t, { name: 'closed' });
  w.createEntity(t, { name: 'open' });
  const doing = w.createEntity(t, { name: 'doing' });
  w.setState(closed.id, 'State', 'Closed');
  w.setState(doing.id, 'State', 'Doing');
  // By name this read closed, doing, open.
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'State' }] })), ['open', 'doing', 'closed']);
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'State', dir: 'desc' }] })), ['closed', 'doing', 'open']);
});

test('a multiselect and a relation keep sorting by the names they paint (Issue #318)', () => {
  // Kyle left references open ("for references its not clear what it should
  // be"), and a multiselect holds several options, so neither has one place
  // in a definition to sort by. Both keep the order they had: the painted
  // names, joined, compared as text.
  const { w, t } = planning();
  const other = w.createTable({ space: 'Plan', name: 'Owner' });
  w.addRelation(t, { name: 'Owners', targetDb: other, cardinality: 'many-to-many', inverseName: 'Items' });
  const apple = w.createEntity(other, { name: 'apple' });
  const zebra = w.createEntity(other, { name: 'zebra' });
  w.createEntity(t, { name: 'z', values: { Tags: ['zeta'], Owners: [zebra.id] } });
  w.createEntity(t, { name: 'az', values: { Tags: ['alpha', 'zeta'], Owners: [apple.id, zebra.id] } });
  w.createEntity(t, { name: 'm', values: { Tags: ['mid'], Owners: [apple.id] } });
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Tags' }] })), ['az', 'm', 'z'], 'alpha,zeta < mid < zeta, never the definition order zeta, alpha, mid');
  assert.deepEqual(names(w.query(t, { sort: [{ field: 'Owners' }] })), ['m', 'az', 'z'], 'apple < apple, zebra < zebra');
});

/* The system columns (Issues #254, #273). The engine could always read them
   (#pathValue knew createdAt, updatedAt and publicId); the table's stored
   sort refused them, because its check asked getField(), which only knows
   the table's own fields. */
function stamped() {
  const w = new Weave();
  w.createSpace({ name: 'Log' });
  const t = w.createTable({ space: 'Log', name: 'Entry' });
  const rows = [
    { name: 'middle', by: 'mia', at: '2026-09-10T08:00:00.000Z', mod: '2026-09-20T08:00:00.000Z' },
    { name: 'oldest', by: 'zed', at: '2026-09-01T08:00:00.000Z', mod: '2026-09-02T08:00:00.000Z' },
    { name: 'newest', by: 'amy', at: '2026-09-12T08:00:00.000Z', mod: '2026-09-13T08:00:00.000Z' },
  ];
  for (const r of rows) {
    w.actor = r.by;
    const e = w.createEntity(t, { name: r.name });
    // Rows made in one test land in the same millisecond; the stamps are set
    // by hand so the order is the stamps' and not the clock's.
    w.state.entities[e.id].createdAt = r.at;
    w.state.entities[e.id].updatedAt = r.mod;
  }
  return { w, t };
}

// The sort is the default view's since Feature #229; the schema speaks it.
const sortOf = (w, t) => w.describeSchema().flatMap((s) => s.tables).find((x) => x.id === w.getTable(t).id).sort;

test('a table sorts by Created At, Modified At, Created By, Modified By and its # (Issues #254, #273)', () => {
  const { w, t } = stamped();
  const by = (field, dir) => {
    w.updateTable(t, { sort: [{ field, dir }] });
    assert.deepEqual(sortOf(w, t), [{ field, dir }], `${field} is stored under its own name`);
    return names(w.query(t, { sort: sortOf(w, t) }));
  };
  assert.deepEqual(by('Created At', 'asc'), ['oldest', 'middle', 'newest']);
  assert.deepEqual(by('Created At', 'desc'), ['newest', 'middle', 'oldest']);
  assert.deepEqual(by('Modified At', 'desc'), ['middle', 'newest', 'oldest']);
  assert.deepEqual(by('Created By', 'asc'), ['newest', 'middle', 'oldest'], 'amy < mia < zed');
  assert.deepEqual(by('Modified By', 'desc'), ['oldest', 'middle', 'newest']);
  // The # column: rows were made middle, oldest, newest, so #1, #2, #3.
  assert.deepEqual(by('Public Id', 'desc'), ['newest', 'oldest', 'middle']);
  // The schema the browser reads carries it, so the grid opens sorted.
  const schema = w.describeSchema().flatMap((s) => s.tables).find((x) => x.id === w.getTable(t).id);
  assert.deepEqual(schema.sort, [{ field: 'Public Id', dir: 'desc' }]);
});

test('Activity and unknown names are still refused as a sort, and a field of that name wins (Issue #254)', () => {
  const { w, t } = stamped();
  // Activity is a count that links to the history, not a value to order by.
  assert.throws(() => w.updateTable(t, { sort: [{ field: 'Activity' }] }), /not found/);
  assert.throws(() => w.updateTable(t, { sort: [{ field: 'Nope' }] }), /not found/);
  // A table that has its own field called Created At (an import, say) sorts
  // by that field: the table's fields are asked first.
  w.addField(t, { name: 'Created At', type: 'number' });
  const rows = w.query(t, {}).items;
  rows.forEach((r, i) => w.updateEntity(r.id, { 'Created At': 10 - i }));
  w.updateTable(t, { sort: [{ field: 'Created At' }] });
  assert.deepEqual(names(w.query(t, { sort: sortOf(w, t) })), rows.map((r) => r.name).reverse());
});
