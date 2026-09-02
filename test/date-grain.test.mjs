/* Grain and costume (2026-09-02, Kyle's ruling over the field-costumes
   explorer). A date field declares two things separately:

     grain   — which parts it CAPTURES and stores: any contiguous run of
               year · month · day, plus a time of day. Rent falls on the 15th
               of no particular month; a card expires in a month, never on a
               day. Storing the missing part would store a lie.
     costume — how the stored parts PRINT: a style (iso us eu long short month
               quarter ordinal relative), a clock (24h | 12h), what a clock
               time means (floating | fixed zone | instant), zero-padding.

   The rule between them: a costume that needs a part the grain never stored
   is refused at definition time, not rendered as a guess.

   Storage follows ISO 8601 truncated forms (XSD gYear / gYearMonth /
   gMonthDay / gDay): 2026-08 · 2026 · --08-15 · ---15 · --08 · 09:15.
   Every existing date field is grain year·month·day with a floating clock,
   which is exactly what its values already are — nothing migrates.

   Engine and public/date-core.js render through one rule, contract-tested
   here the same way the four original formats are in date-core.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
await import('../public/date-core.js');
const core = globalThis.weaveDateCore;

/* A fixed clock: Wednesday 26 Aug 2026, 14:32. `short` drops a current-year
   year and `relative` counts from today, so both read the engine's clock,
   which a test may pin. */
const NOW = new Date(2026, 7, 26, 14, 32);

function fresh(config = {}, type = 'date') {
  const w = new Weave();
  w.now = () => NOW;
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'T' });
  w.addField('T', { name: 'D', type, config });
  return w;
}
const fieldOf = (w) => Object.values(w.getTable('T').fields).find((f) => f.name === 'D');
const stored = (w, value) => {
  const e = w.createEntity('T', { name: 'x', values: { D: value } });
  return w.getEntity(e.id).values[fieldOf(w).id];
};
const shown = (w, value) => {
  const e = w.createEntity('T', { name: 'x', values: { D: value } });
  return w.readEntity(e.id).fields.D;
};
/* The browser renders through date-core with the same config the engine
   holds; a costume the two disagree on is a bug in one of them. */
const both = (config, value, expected, msg) => {
  const w = fresh(config);
  assert.equal(shown(w, value), expected, `engine: ${msg ?? expected}`);
  assert.equal(core.formatDate(stored(w, value), { ...fieldOf(w).config, now: NOW, viewerZone: 'UTC' }), expected, `date-core: ${msg ?? expected}`);
};

/* ---------- grain: what the field captures ---------- */

test('grain is a contiguous run of year·month·day, stored in canonical order, omitted when full', () => {
  assert.deepEqual(fieldOf(fresh({ grain: ['day', 'month'] })).config.grain, ['month', 'day']);
  assert.deepEqual(fieldOf(fresh({ grain: ['month'] })).config.grain, ['month']);
  assert.equal(fieldOf(fresh({ grain: ['year', 'month', 'day'] })).config.grain, undefined, 'the full grain is the default and says nothing');
  assert.equal(fieldOf(fresh({})).config.grain, undefined);
  assert.throws(() => fresh({ grain: ['year', 'day'] }), /grain/i, 'a year with a day and no month is not a shape');
  assert.throws(() => fresh({ grain: ['weekday'] }), /grain/i);
  assert.throws(() => fresh({ grain: [] }), /time/i, 'no parts at all is only a field when it keeps a time');
  assert.deepEqual(fieldOf(fresh({ grain: [], time: true })).config.grain, [], 'a time-of-day field');
});

test('a partial grain stores the ISO 8601 truncated form, and a fuller value is cut to it — never padded', () => {
  const ym = fresh({ grain: ['year', 'month'] });
  assert.equal(stored(ym, '2026-08'), '2026-08');
  assert.equal(stored(ym, '2026-08-15'), '2026-08', 'a full date loses its day on the way in');
  assert.equal(stored(ym, '2026-08-15T09:15'), '2026-08');
  assert.throws(() => stored(ym, '2026'), /month/i, 'a year alone cannot invent a month');
  assert.throws(() => stored(ym, '08/2026'), /date/i);

  const y = fresh({ grain: ['year'] });
  assert.equal(stored(y, '2026'), '2026');
  assert.equal(stored(y, '2026-08-15'), '2026');
  assert.equal(stored(y, 2026), '2026', 'a number is a year');

  const md = fresh({ grain: ['month', 'day'] });
  assert.equal(stored(md, '--08-15'), '--08-15');
  assert.equal(stored(md, '2026-08-15'), '--08-15', 'the year is dropped, not kept in secret');
  assert.throws(() => stored(md, '--13-01'), /month/i);
  assert.throws(() => stored(md, '--02-30'), /day/i);

  const d = fresh({ grain: ['day'] });
  assert.equal(stored(d, '---15'), '---15');
  assert.equal(stored(d, 15), '---15', 'a bare number is a day of the month');
  assert.equal(stored(d, '3'), '---03');
  assert.equal(stored(d, '2026-08-15'), '---15');
  assert.throws(() => stored(d, '---32'), /day/i);
  assert.throws(() => stored(d, '2026-08'), /day/i, 'no day to keep');

  const m = fresh({ grain: ['month'] });
  assert.equal(stored(m, '--08'), '--08');
  assert.equal(stored(m, '2026-08'), '--08');
  assert.equal(stored(m, 8), '--08');

  const t = fresh({ grain: [], time: true });
  assert.equal(stored(t, '09:15'), '09:15');
  assert.equal(stored(t, '9:15'), '09:15', 'a single-digit hour is padded, not refused');
  assert.equal(stored(t, '2026-08-15T09:15'), '09:15', 'a stamp keeps only its clock');
  assert.throws(() => stored(t, '25:00'), /time/i);
  assert.throws(() => stored(t, '2026-08-15'), /time/i, 'a day carries no clock to keep');
});

test('the full grain keeps its old lenient rule: anything Date.parse reads, stored as given', () => {
  const w = fresh({});
  assert.equal(stored(w, '2026-08-21'), '2026-08-21');
  assert.equal(stored(w, '2026-08-21T14:30'), '2026-08-21T14:30');
  assert.throws(() => stored(w, 'nope'), /not a valid date/);
});

test('today() and now() defaults resolve to the field\'s grain', () => {
  const at = (config) => {
    const w = fresh({ ...config, default: config.time ? 'now()' : 'today()' });
    const e = w.createEntity('T', { name: 'x' });
    return w.getEntity(e.id).values[fieldOf(w).id];
  };
  const today = NOW.toISOString().slice(0, 10);
  assert.equal(at({}), today);
  assert.equal(at({ grain: ['year', 'month'] }), today.slice(0, 7));
  assert.equal(at({ grain: ['year'] }), today.slice(0, 4));
  assert.equal(at({ grain: ['month', 'day'] }), '--' + today.slice(5));
  assert.equal(at({ grain: ['day'] }), '---' + today.slice(8));
  assert.match(at({ grain: [], time: true }), /^\d{2}:\d{2}$/);
});

test('formulas read the parts a partial value actually holds', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'T' });
  w.addField('T', { name: 'YM', type: 'date', config: { grain: ['year', 'month'] } });
  w.addField('T', { name: 'MD', type: 'date', config: { grain: ['month', 'day'] } });
  w.addField('T', { name: 'DD', type: 'date', config: { grain: ['day'] } });
  w.addField('T', { name: 'Y', type: 'formula', config: { expression: 'year(YM)' } });
  w.addField('T', { name: 'M', type: 'formula', config: { expression: 'month(MD)' } });
  w.addField('T', { name: 'DayOf', type: 'formula', config: { expression: 'day(DD)' } });
  const e = w.createEntity('T', { name: 'x', values: { YM: '2026-08', MD: '--08-15', DD: '---15' } });
  const r = w.readEntity(e.id).fields;
  assert.equal(r.Y, 2026);
  assert.equal(r.M, 8);
  assert.equal(r.DayOf, 15);
});

/* ---------- costume: how the parts print ---------- */

test('a style that needs a part the grain never stored is refused at definition time', () => {
  assert.throws(() => fresh({ grain: ['day'], format: 'month' }), /month/i);
  assert.throws(() => fresh({ grain: ['day'], format: 'quarter' }), /month/i);
  assert.throws(() => fresh({ grain: ['day'], format: 'relative' }), /year/i);
  assert.throws(() => fresh({ grain: ['month', 'day'], format: 'relative' }), /year/i);
  assert.throws(() => fresh({ grain: ['year', 'month'], format: 'ordinal' }), /day/i);
  assert.throws(() => fresh({ grain: ['year'], format: 'month' }), /month/i);
  assert.throws(() => fresh({ grain: [], time: true, format: 'long' }), /date parts|no date/i);
  assert.throws(() => fresh({ format: 'stardate' }), /format/i, 'the enum still holds');
  assert.equal(core.legalFormats(['day']).includes('ordinal'), true);
  assert.deepEqual(core.legalFormats(['day']).filter((f) => ['month', 'quarter', 'relative'].includes(f)), []);
  assert.deepEqual(core.legalFormats([]), []);
  assert.equal(core.legalFormats(['year', 'month', 'day']).length, core.DATE_FORMATS.length);
});

test('the nine styles, on the full grain (the four shipped ones unchanged)', () => {
  both({ format: 'iso' }, '2026-08-15', '2026-08-15');
  both({ format: 'us' }, '2026-08-15', '8/15/2026');
  both({ format: 'us', pad: true }, '2026-08-15', '08/15/2026');
  both({ format: 'eu' }, '2026-08-15', '15.8.2026');
  both({ format: 'eu', pad: true }, '2026-08-15', '15.08.2026');
  both({ format: 'long' }, '2026-08-15', 'Aug 15, 2026');
  both({ format: 'short' }, '2026-08-15', 'Aug 15', 'short drops a current-year year');
  both({ format: 'short' }, '2025-12-31', 'Dec 31, 2025', 'and keeps any other');
  both({ format: 'month' }, '2026-08-15', 'August 2026');
  both({ format: 'quarter' }, '2026-08-15', 'Q3 2026');
  both({ format: 'ordinal' }, '2026-08-15', 'August 15th, 2026');
  both({ format: 'ordinal' }, '2026-08-01', 'August 1st, 2026');
  both({ format: 'ordinal' }, '2026-08-22', 'August 22nd, 2026');
  both({ format: 'ordinal' }, '2026-08-11', 'August 11th, 2026', '11th, not 11st');
  both({ format: 'relative' }, '2026-08-26', 'today');
  both({ format: 'relative' }, '2026-08-27', 'tomorrow');
  both({ format: 'relative' }, '2026-08-24', '2 days ago');
  both({ format: 'relative' }, '2026-09-09', 'in 2 weeks');
  both({ format: 'relative' }, '2026-11-20', 'in 3 months');
  both({ format: 'relative' }, '2024-03-01', '2 years ago');
});

test('a partial grain dresses only the parts it holds — even iso, which prints the parts, never the dashes', () => {
  const ym = { grain: ['year', 'month'] };
  both({ ...ym }, '2026-08', '2026-08', 'iso');
  both({ ...ym, format: 'us' }, '2026-08', '8/2026', 'card expiry, unpadded');
  both({ ...ym, format: 'us', pad: true }, '2026-08', '08/2026', 'card expiry, MM/YYYY');
  both({ ...ym, format: 'eu' }, '2026-08', '8.2026');
  both({ ...ym, format: 'long' }, '2026-08', 'Aug 2026');
  both({ ...ym, format: 'short' }, '2026-08', 'Aug', 'a monthly column in the current year');
  both({ ...ym, format: 'short' }, '2025-12', 'Dec 2025');
  both({ ...ym, format: 'month' }, '2026-08', 'August 2026');
  both({ ...ym, format: 'quarter' }, '2026-08', 'Q3 2026');
  both({ ...ym, format: 'relative' }, '2026-10', 'in 2 months');
  both({ ...ym, format: 'relative' }, '2026-08', 'this month');

  const y = { grain: ['year'] };
  both({ ...y }, '2026', '2026');
  for (const format of ['us', 'eu', 'long', 'short']) both({ ...y, format }, '2026', '2026', format);
  both({ ...y, format: 'relative' }, '2027', 'next year');

  const md = { grain: ['month', 'day'] };
  both({ ...md }, '--08-15', '08-15');
  both({ ...md, format: 'us' }, '--08-15', '8/15');
  both({ ...md, format: 'eu' }, '--08-15', '15.8.');
  both({ ...md, format: 'long' }, '--08-15', 'Aug 15', 'an anniversary');
  both({ ...md, format: 'short' }, '--08-15', 'Aug 15');
  both({ ...md, format: 'month' }, '--08-15', 'August');
  both({ ...md, format: 'quarter' }, '--08-15', 'Q3');
  both({ ...md, format: 'ordinal' }, '--08-15', 'August 15th');

  const d = { grain: ['day'] };
  both({ ...d }, '---15', '15');
  both({ ...d, format: 'us' }, '---15', '15');
  both({ ...d, format: 'eu' }, '---15', '15.');
  both({ ...d, format: 'long' }, '---15', 'the 15th', 'rent day');
  both({ ...d, format: 'short' }, '---15', 'the 15th');
  both({ ...d, format: 'ordinal' }, '---15', 'the 15th');
  both({ ...d, format: 'ordinal' }, '---03', 'the 3rd');

  const m = { grain: ['month'] };
  both({ ...m }, '--08', '08');
  both({ ...m, format: 'us' }, '--08', '8');
  both({ ...m, format: 'long' }, '--08', 'Aug');
  both({ ...m, format: 'month' }, '--08', 'August');
  both({ ...m, format: 'quarter' }, '--08', 'Q3');
});

test('a clock is 24h unless the field says 12h; it rides every style and the time-only grain', () => {
  both({ time: true }, '2026-08-15T14:32', '2026-08-15 14:32');
  both({ time: true, clock: '12h' }, '2026-08-15T14:32', '2026-08-15 2:32 PM');
  both({ time: true, clock: '12h', format: 'long' }, '2026-08-15T09:05', 'Aug 15, 2026 9:05 AM');
  both({ time: true, clock: '12h' }, '2026-08-15T00:15', '2026-08-15 12:15 AM');
  both({ time: true, clock: '12h' }, '2026-08-15T12:00', '2026-08-15 12:00 PM');
  both({ grain: [], time: true }, '09:15', '09:15', 'opening time');
  both({ grain: [], time: true, clock: '12h' }, '17:40', '5:40 PM');
  assert.throws(() => fresh({ clock: '12h' }), /time/i, 'a clock without a time of day is nothing');
  assert.throws(() => fresh({ time: true, clock: '10h' }), /clock/i);
});

test('what a clock time means: floating (today\'s silent rule, now named), a fixed zone, or an instant', () => {
  assert.equal(fieldOf(fresh({ time: true, zone: 'floating' })).config.zone, undefined, 'floating is the default and says nothing');
  assert.throws(() => fresh({ zone: 'fixed', zoneName: 'America/Los_Angeles' }), /time/i, 'a zone without a time is nothing');
  assert.throws(() => fresh({ time: true, zone: 'fixed' }), /zoneName/i);
  assert.throws(() => fresh({ time: true, zone: 'fixed', zoneName: 'Mars/Olympus' }), /zone/i);
  assert.throws(() => fresh({ time: true, zone: 'sometimes' }), /zone/i);

  // fixed: the wall clock stays as typed and the zone travels with the field.
  both({ time: true, zone: 'fixed', zoneName: 'America/Los_Angeles' }, '2026-08-15T09:15', '2026-08-15 09:15 PDT');
  both({ time: true, zone: 'fixed', zoneName: 'America/Los_Angeles' }, '2026-01-15T09:15', '2026-01-15 09:15 PST', 'the abbreviation follows the date');
  both({ time: true, zone: 'fixed', zoneName: 'Europe/Berlin', clock: '12h', format: 'long' }, '2026-08-15T17:40', 'Aug 15, 2026 5:40 PM GMT+2');

  // instant: stored as UTC, rendered in whatever zone is reading it.
  const w = fresh({ time: true, zone: 'instant' });
  assert.equal(stored(w, '2026-08-15T16:15Z'), '2026-08-15T16:15Z');
  assert.equal(stored(w, '2026-08-15T09:15-07:00'), '2026-08-15T16:15Z', 'an offset is folded into UTC');
  assert.equal(stored(w, '2026-08-15T16:15'), '2026-08-15T16:15Z', 'a bare wall clock written through the API is taken as UTC');
  assert.equal(shown(w, '2026-08-15T16:15Z'), '2026-08-15 16:15 UTC', 'the engine has no reader, so it reads in UTC');
  const cfg = { ...fieldOf(w).config, now: NOW };
  assert.equal(core.formatDate('2026-08-15T16:15Z', { ...cfg, viewerZone: 'America/Los_Angeles' }), '2026-08-15 09:15 PDT');
  assert.equal(core.formatDate('2026-08-15T16:15Z', { ...cfg, viewerZone: 'Europe/Berlin' }), '2026-08-15 18:15 GMT+2');
  assert.equal(core.formatDate('2026-08-15T23:30Z', { ...cfg, viewerZone: 'Asia/Tokyo', format: 'long' }), 'Aug 16, 2026 08:30 GMT+9', 'the day follows the zone');
  assert.equal(core.toInstant('2026-08-15T09:15', 'America/Los_Angeles'), '2026-08-15T16:15Z', 'the browser folds a typed local time into UTC');
  assert.equal(core.toInstant('2026-01-15T09:15', 'America/Los_Angeles'), '2026-01-15T17:15Z', 'and respects DST');
  assert.equal(core.fromInstant('2026-08-15T16:15Z', 'America/Los_Angeles'), '2026-08-15T09:15');
});

/* ---------- ranges ---------- */

test('a range wears the grain and costume at both ends; elapsed time is opt-in and derived, never stored', () => {
  const rng = (config) => {
    const w = fresh(config, 'daterange');
    return (value) => {
      const e = w.createEntity('T', { name: 'x', values: { D: value } });
      const engine = w.readEntity(e.id).fields.D;
      const browser = core.formatDateRange(w.getEntity(e.id).values[fieldOf(w).id], { ...fieldOf(w).config, now: NOW, viewerZone: 'UTC' });
      assert.equal(browser, engine, 'engine and date-core agree');
      return engine;
    };
  };
  assert.equal(rng({ grain: ['year', 'month'], format: 'long' })({ start: '2026-08', end: '2026-11' }), 'Aug 2026 – Nov 2026');
  assert.equal(rng({ grain: [], time: true, clock: '12h' })({ start: '09:15', end: '17:40' }), '9:15 AM – 5:40 PM', 'opening hours');
  assert.equal(rng({ grain: [], time: true, elapsed: true })({ start: '09:15', end: '17:40' }), '09:15 – 17:40 · 8h 25m');
  assert.equal(rng({ grain: [], time: true, elapsed: true })({ start: '22:00', end: '06:00' }), '22:00 – 06:00 · 8h', 'a night shift crosses midnight');
  assert.equal(rng({ time: true, elapsed: true, format: 'short' })({ start: '2026-08-15T09:15', end: '2026-08-15T17:40' }), 'Aug 15 09:15 – Aug 15 17:40 · 8h 25m');
  assert.equal(rng({ time: true, elapsed: true })({ start: '2026-08-15T22:00', end: '2026-08-17T06:30' }), '2026-08-15 22:00 – 2026-08-17 06:30 · 1d 8h 30m');
  assert.equal(rng({ time: true })({ start: '2026-08-15T09:15', end: '2026-08-15T17:40' }), '2026-08-15 09:15 – 2026-08-15 17:40', 'no elapsed unless asked');
  assert.throws(() => fresh({ elapsed: true }, 'daterange'), /time/i, 'elapsed needs a clock at both ends');
  assert.equal(rng({ format: 'long' })({ start: '2026-08-01', end: '2026-09-15' }), 'Aug 1 – Sep 15, 2026', 'the same-year collapse survives');
});

/* ---------- the schema surfaces ---------- */

test('grain and costume travel through describeSchema, updateField lanes, and the definition sentence', () => {
  const w = fresh({ grain: ['year', 'month'], format: 'us', pad: true });
  const desc = () => w.describeSchema().find((sp) => sp.space === 'Dev').tables[0].fields.find((f) => f.name === 'D');
  assert.deepEqual(desc().grain, ['year', 'month']);
  assert.equal(desc().format, 'us');
  assert.equal(desc().pad, true);

  w.updateField('T', 'D', { config: { width: 140 } });
  assert.deepEqual(fieldOf(w).config.grain, ['year', 'month'], 'a width edit never clobbers the grain');
  w.updateField('T', 'D', { config: { format: 'quarter', pad: null } });
  assert.equal(fieldOf(w).config.format, 'quarter');
  assert.equal(fieldOf(w).config.pad, undefined, 'null clears a lane');
  assert.throws(() => w.updateField('T', 'D', { config: { format: 'ordinal' } }), /day/i, 'the legality rule holds on edit too');
  w.updateField('T', 'D', { config: { grain: ['year', 'month', 'day'] } });
  assert.equal(fieldOf(w).config.grain, undefined, 'widening back to the full grain drops the key');

  const t = fresh({ grain: [], time: true, clock: '12h', zone: 'fixed', zoneName: 'Europe/Berlin' });
  const td = t.describeSchema().find((sp) => sp.space === 'Dev').tables[0].fields.find((f) => f.name === 'D');
  assert.deepEqual(td.grain, []);
  assert.equal(td.clock, '12h');
  assert.equal(td.zone, 'fixed');
  assert.equal(td.zoneName, 'Europe/Berlin');

  // The registry's one-line description of a field names a partial grain.
  const reg = fresh({ grain: ['day'], format: 'ordinal' });
  reg.addField('T', { name: 'Def', type: 'field', config: {} });
  const e = reg.createEntity('T', { name: 'x', values: { Def: { type: 'date', config: { grain: ['day'], format: 'ordinal' } } } });
  assert.equal(reg.readEntity(e.id).fields.Def, 'date · day · ordinal');
});

test('a schema document round-trips every grain and costume key', () => {
  const w = fresh({ grain: ['month', 'day'], format: 'long' });
  w.addField('T', { name: 'At', type: 'date', config: { time: true, clock: '12h', zone: 'instant' } });
  w.addField('T', { name: 'Hours', type: 'daterange', config: { grain: [], time: true, elapsed: true } });
  const doc = w.describeSchema();
  const w2 = new Weave();
  w2.applySchema(doc);
  const f = (name) => Object.values(w2.getTable('T').fields).find((x) => x.name === name).config;
  assert.deepEqual(f('D').grain, ['month', 'day']);
  assert.equal(f('D').format, 'long');
  assert.equal(f('At').clock, '12h');
  assert.equal(f('At').zone, 'instant');
  assert.deepEqual(f('Hours').grain, []);
  assert.equal(f('Hours').elapsed, true);
  assert.deepEqual(w2.applySchema(doc, { dryRun: true }), [], 'applying the same document again is a no-op');
});
