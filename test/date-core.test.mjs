/* public/date-core.js — the pure half of the calendar popover and the
   format examples in the field tray (2026-08-23). Display formatting is
   contract-tested against the engine's own costume so the tray's examples
   are exactly what a cell will show. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

await import('../public/date-core.js');
const core = globalThis.weaveDateCore;

test('formatDate matches the engine costume for every format, with and without time', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'T' });
  for (const format of ['iso', 'us', 'eu', 'long']) {
    for (const time of [false, true]) {
      const f = w.addField(t, { name: `d-${format}-${time}`, type: 'date', config: { format, time } });
      const iso = time ? '2026-08-03T14:05' : '2026-08-03';
      const e = w.createEntity(t, { name: 'x', values: { [f.name]: iso } });
      assert.equal(core.formatDate(iso, { format, time }), w.readEntity(e.id).fields[f.name], `${format}/${time}`);
    }
  }
});

test('formatDate never reads the local zone: the stored wall-clock parts are what render', () => {
  assert.equal(core.formatDate('2026-08-21', { format: 'long' }), 'Aug 21, 2026');
  assert.equal(core.formatDate('2026-08-21T23:30', { format: 'us', time: true }), '8/21/2026 23:30');
});

test('calendarMonth lays out a Sunday-first grid of full weeks with in-month flags (the native picker Kyle liked)', () => {
  const grid = core.calendarMonth(2026, 8); // August 2026 starts on a Saturday
  assert.equal(grid.length, 6);
  assert.equal(grid[0].length, 7);
  assert.equal(grid[0][6].iso, '2026-08-01');
  assert.equal(grid[0][0].inMonth, false);
  assert.equal(grid[0][0].iso, '2026-07-26');
  assert.deepEqual(core.WEEKDAYS, ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  assert.equal(grid.flat().filter((c) => c.inMonth).length, 31);
});

test('shiftMonth wraps years; decade gives a 12-year window around the year', () => {
  assert.deepEqual(core.shiftMonth(2026, 12, 1), [2027, 1]);
  assert.deepEqual(core.shiftMonth(2026, 1, -1), [2025, 12]);
  const years = core.decade(2026);
  assert.equal(years.length, 12);
  assert.ok(years.includes(2026));
  assert.equal(years[0], 2020);
});

test('splitIso / joinIso carry a time of day across a day change', () => {
  assert.deepEqual(core.splitIso('2026-08-21T09:30'), { date: '2026-08-21', time: '09:30' });
  assert.deepEqual(core.splitIso('2026-08-21'), { date: '2026-08-21', time: '' });
  assert.equal(core.joinIso('2026-09-01', '09:30'), '2026-09-01T09:30');
  assert.equal(core.joinIso('2026-09-01', ''), '2026-09-01');
});

test('default choices: none, today()/now(), or a specific value — parsed back the same way', () => {
  assert.equal(core.defaultKind(''), 'none');
  assert.equal(core.defaultKind('today()'), 'today');
  assert.equal(core.defaultKind('now()'), 'today');
  assert.equal(core.defaultKind('2026-08-21'), 'specific');
  assert.deepEqual(core.DYNAMIC_DATE_DEFAULTS, ['today()', 'now()']);
});

/* ---------- date ranges (Issue #91) ----------
   A daterange stores `{ start, end }`. The read side had no case for it, so
   the object walked all the way to the browser and painted itself as
   '[object Object]'. Same contract as a single date: the costume lives in
   date-core, the engine renders through the same rule, and the tray's
   examples are exactly what a cell shows. */

const rangeField = (config) => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'T' });
  w.addField(t, { name: 'Window', type: 'daterange', config });
  return (value) => {
    const e = w.createEntity(t, { name: 'x', values: { Window: value } });
    return w.readEntity(e.id).fields.Window;
  };
};

test('a daterange reads as text, never as an object (Issue #91)', () => {
  const shown = rangeField({})({ start: '2026-08-01', end: '2026-09-15' });
  assert.equal(typeof shown, 'string');
  assert.equal(shown, '2026-08-01 – 2026-09-15');
  assert.ok(!shown.includes('object'));
});

test('formatDateRange matches the engine costume for every format', () => {
  for (const format of ['iso', 'us', 'eu', 'long']) {
    const value = { start: '2026-08-01', end: '2026-09-15' };
    assert.equal(core.formatDateRange(value, { format }), rangeField({ format })(value), format);
  }
});

test('a long range inside one year prints the year once, across years prints both', () => {
  assert.equal(core.formatDateRange({ start: '2026-08-01', end: '2026-09-15' }, { format: 'long' }), 'Aug 1 – Sep 15, 2026');
  assert.equal(core.formatDateRange({ start: '2026-11-02', end: '2027-03-03' }, { format: 'long' }), 'Nov 2, 2026 – Mar 3, 2027');
});

test('numeric formats keep both ends whole', () => {
  const value = { start: '2026-08-01', end: '2026-09-15' };
  assert.equal(core.formatDateRange(value, { format: 'us' }), '8/1/2026 – 9/15/2026');
  assert.equal(core.formatDateRange(value, { format: 'eu' }), '1.8.2026 – 15.9.2026');
});

test('time rides on both ends when the field asks for it', () => {
  const value = { start: '2026-08-01T09:00', end: '2026-08-01T17:30' };
  assert.equal(core.formatDateRange(value, { time: true }), '2026-08-01 09:00 – 2026-08-01 17:30');
  assert.equal(rangeField({ time: true })(value), '2026-08-01 09:00 – 2026-08-01 17:30');
});

test('a half-written range says what it has rather than painting an object', () => {
  assert.equal(core.formatDateRange(null, {}), '');
  assert.equal(core.formatDateRange({ start: '2026-08-01', end: '' }, {}), '2026-08-01 –');
  assert.equal(core.formatDateRange({ start: '', end: '2026-09-15' }, {}), '– 2026-09-15');
});
