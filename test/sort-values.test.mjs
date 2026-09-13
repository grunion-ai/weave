/* A sort orders the value, never its costume (Issue #279).

   uno's Agent/Sessions grid — 720 rows, sorted Created descending, Created a
   `date` field wearing the `long` format — put "Sep 9, 2026 9:51 AM" above
   every row created on Sep 12: the comparator was handed the painted string,
   and "Sep 9" beats "Sep 12" as text. The same defect ordered `$17.25` above
   `$9.50` and `15,829,984` below `900`.

   The rule is the one a formula already reads by (#resolve): a number stays a
   number, a date stays its stored instant, and everything else — option and
   state names, joined relations — sorts by what the reader sees, because
   that IS its value. */
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

test('a select still sorts by the option name the reader sees, not by its id', () => {
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
