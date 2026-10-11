import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed } from '../scripts/seed.mjs';

test('demo seed builds a coherent workspace', () => {
  const w = new Weave();
  const { apollo, t3, ada } = seed(w);

  const proj = w.readEntity(apollo.id);
  assert.equal(proj.fields['Task Count'], 3);
  assert.equal(proj.fields['Total Estimate'], 24);
  assert.match(proj.fields['Task List'], /Design onboarding wizard/);

  const done = w.readEntity(t3.id);
  assert.match(done.doc, /✅ Completed on [A-Z][a-z]{2} \d{1,2}, \d{4}/, '{{Today}} wears the date costume (Issue #676)');
  assert.ok(done.comments.some((c) => c.text.includes('moved to Done')));

  assert.equal(done.fields['Project Budget'], 120000);
  assert.equal(done.fields.Size, 'small');

  assert.equal(w.readEntity(ada.id).fields['Open Load'], 16);

  const schema = w.describeSchema();
  assert.equal(schema.filter((sp) => !sp.system).length, 2);
  assert.equal(schema.filter((sp) => sp.system).length, 1);
});

import { seedWeaver, seedFieldShowcase, DEFINABLE_TYPES as SHOWCASE_TYPES } from '../src/weaver-seed.js';

test('seedWeaver includes a Showcase space covering every field type and multiple configs per type', () => {
  const w = seedWeaver(new Weave());
  const view = w.describeSchema().find((s) => s.space === 'Showcase');
  assert.ok(view, 'Showcase space exists');
  const ft = view.tables.find((t) => t.name === 'Field Types');
  assert.ok(ft, 'Field Types table exists');
  const types = new Set(ft.fields.map((f) => f.type));
  for (const t of [...SHOWCASE_TYPES, 'relation', 'lookup', 'rollup', 'formula']) {
    assert.ok(types.has(t), `${t} is represented`);
  }
  const ofType = (t) => ft.fields.filter((f) => f.type === t);
  assert.ok(ofType('number').length >= 4, 'number: plain, currency, percent, unit');
  assert.equal(new Set(ofType('number').map((f) => `${f.format ?? 'number'}|${f.unit ?? ''}|${f.decimals ?? ''}|${f.display ?? 'text'}|${f.scale ?? 'column'}|${f.color ?? ''}`)).size, ofType('number').length, 'every number field is a distinct configuration');
  assert.ok(ofType('date').length >= 3, 'date: iso, us, long+time');
  assert.ok(ofType('select').length >= 2 && ofType('select').some((f) => f.optionsFull.some((o) => o.color)), 'select: colored and plain');
  assert.ok(ofType('workflow').length >= 2, 'workflow: full lifecycle and a two-state gate');
  assert.ok(ofType('rollup').length >= 3, 'rollup: count, an aggregate, a join');
  assert.ok(ofType('formula').length >= 3, 'formula: numeric, text, date');
  assert.ok(ofType('field').length >= 2, 'field: depth 1 and a nested definition');
  assert.ok(ofType('relation').length >= 2, 'relation: single and many');
  const rows = w.listEntities(ft.id).map((e) => w.readEntity(e.id));
  assert.ok(rows.length >= 3);
  const rich = rows.find((r) => r.name === 'Sensor board');
  assert.equal(rich.fields.Total, 1794, 'a numeric formula over two number configs');
  assert.match(String(rich.fields.Price), /149\.50/, 'currency config renders 2 decimals');
  assert.ok(rows.some((r) => r.fields['Peer count'] >= 2), 'a rollup over a many relation');
});

import { NUMBER_DISPLAYS, SPARKLINE_STYLES, CELL_COLORS } from '../src/engine.js';

test('the Showcase wears every number display, on the column scale and a fixed one (Feature #230)', () => {
  const w = seedWeaver(new Weave());
  const ft = w.describeSchema().find((s) => s.space === 'Showcase').tables.find((t) => t.name === 'Field Types');
  const numbers = ft.fields.filter((f) => f.type === 'number');
  for (const d of NUMBER_DISPLAYS) assert.ok(numbers.some((f) => (f.display ?? 'text') === d), `a number field wears display '${d}'`);
  const graphic = numbers.filter((f) => f.display && f.display !== 'text');
  assert.ok(graphic.some((f) => f.display === 'bar' && f.scale == null), 'a bar on the column scale');
  assert.ok(graphic.some((f) => ['bar', 'ring'].includes(f.display) && typeof f.scale === 'number'), 'a bar or ring on a fixed scale');
  assert.ok(graphic.some((f) => f.display === 'ring' && f.format === 'percent'), 'a percent ring');
  const rows = w.listEntities(ft.id).map((e) => w.getEntity(e.id));
  for (const f of graphic) {
    const drawn = rows.map((r) => r.values[f.id]).filter((v) => typeof v === 'number');
    assert.ok(new Set(drawn).size >= 3, `${f.name} has at least three different values to draw`);
  }
});

test('the Showcase rates past the old cap of 10 and starts new rows at a default (Feature #234)', () => {
  const w = seedWeaver(new Weave());
  const ft = w.findTable('Showcase/Field Types');
  const f = w.findField(ft, 'Brightness');
  assert.ok(f, 'a Brightness rating');
  assert.deepEqual(f.config, { max: 12, icon: 'lucide:sun', default: 6 });
  const fresh = w.createEntity(ft, { name: 'scratch' });
  assert.equal(w.readEntity(fresh.id).raw.Brightness, 6, 'a new row starts at the default');
  assert.equal(w.readEntity(w.findEntity(ft, 'Sync service').id).raw.Brightness, 12, 'a row rated at the top of a twelve-point scale');
});

test('the Showcase rates at max 3, 5 and 7 with two icons, and rolls a rating up (Feature #231)', () => {
  const w = seedWeaver(new Weave());
  const sc = w.describeSchema().find((s) => s.space === 'Showcase');
  const ft = sc.tables.find((t) => t.name === 'Field Types');
  const people = sc.tables.find((t) => t.name === 'People');
  const ratings = ft.fields.filter((f) => f.type === 'rating');
  for (const max of [3, 5, 7]) assert.ok(ratings.some((f) => f.max === max), `a rating with max ${max}`);
  assert.ok(new Set(ratings.map((f) => f.icon)).size >= 2, 'at least two different icons');
  for (const f of ratings) {
    assert.ok(existsSync(new URL(`../public/vendor/icons/${f.icon.slice('lucide:'.length)}.svg`, import.meta.url)), `${f.icon} is vendored`);
  }
  const rows = w.listEntities(ft.id).map((e) => w.getEntity(e.id));
  const cells = ratings.flatMap((f) => rows.map((r) => r.values[f.id]));
  assert.ok(cells.includes(0), 'a rating set to 0');
  assert.ok(cells.some((v) => v == null), 'an unrated cell');
  assert.ok(new Set(cells.filter((v) => v > 0)).size >= 3, 'varied ratings');
  assert.ok(people.fields.some((f) => f.type === 'rating'), 'People carry a rating');
  const rollup = ft.fields.find((f) => f.type === 'rollup' && f.rating && f.aggregate === 'avg');
  assert.ok(rollup, 'an avg rollup over a rating, drawn as icons');
  assert.ok(w.listEntities(ft.id).some((e) => w.readEntity(e.id).fields[rollup.name] > 0), 'the rating rollup resolves on a row');
});

test('the Showcase draws a sparkline in every style from sorted lookups, and shows a null list (Feature #232)', () => {
  const w = seedWeaver(new Weave());
  const ft = w.describeSchema().find((s) => s.space === 'Showcase').tables.find((t) => t.name === 'Field Types');
  const sparks = ft.fields.filter((f) => f.type === 'formula' && f.display === 'sparkline');
  for (const s of SPARKLINE_STYLES) assert.ok(sparks.some((f) => (f.style ?? 'line') === s), `a sparkline in style '${s}'`);
  for (const f of sparks) assert.match(f.expression, /sortby\(/, `${f.name} orders its series with sortby`);
  const rows = w.listEntities(ft.id).map((e) => w.readEntity(e.id));
  for (const f of sparks) {
    assert.ok(rows.some((r) => Array.isArray(r.fields[f.name]) && r.fields[f.name].length >= 2), `${f.name} draws a series of two or more on some row`);
  }
  const winloss = sparks.find((f) => f.style === 'winloss');
  assert.ok(rows.some((r) => (r.fields[winloss.name] ?? []).some((v) => v < 0)), 'the win/loss series has a loss');
  assert.ok(rows.some((r) => (r.fields[winloss.name] ?? []).some((v) => v > 0)), 'the win/loss series has a win');
  const blank = rows.find((r) => r.name === 'Blank row');
  assert.ok(sparks.some((f) => /null/.test(f.expression) && blank.fields[f.name] === null), 'a formula returns null on a row with no peers');
});

test('the Showcase draws each colour setting on a number display, a rating and a sparkline (Feature #235)', () => {
  const w = seedWeaver(new Weave());
  const ft = w.describeSchema().find((s) => s.space === 'Showcase').tables.find((t) => t.name === 'Field Types');
  const kinds = {
    'number display': ft.fields.filter((f) => f.type === 'number' && f.display && f.display !== 'text'),
    rating: ft.fields.filter((f) => f.type === 'rating'),
    sparkline: ft.fields.filter((f) => f.type === 'formula' && f.display === 'sparkline'),
  };
  const rows = w.listEntities(ft.id).map((e) => w.readEntity(e.id));
  for (const [kind, fields] of Object.entries(kinds)) {
    for (const c of CELL_COLORS) {
      const f = fields.find((x) => x.color === c);
      assert.ok(f, `a ${kind} in color '${c}'`);
      assert.ok(rows.filter((r) => r.raw[f.name] != null && !(Array.isArray(r.raw[f.name]) && !r.raw[f.name].length)).length >= 2, `${f.name} has values to draw`);
    }
  }
  assert.ok(new Set(kinds.rating.filter((f) => f.color === 'icon').map((f) => f.icon)).size >= 2, 'two icons in Color by icon');
  assert.ok(kinds.rating.some((f) => f.max === 10), 'a rating out of ten');
});

test('seedFieldShowcase is idempotent — a second run is a no-op', () => {
  const w = seedWeaver(new Weave());
  const before = w.describeSchema().find((s) => s.space === 'Showcase').tables.length;
  seedFieldShowcase(w);
  assert.equal(w.describeSchema().filter((s) => s.space === 'Showcase').length, 1);
  assert.equal(w.describeSchema().find((s) => s.space === 'Showcase').tables.length, before);
});

import { existsSync } from 'node:fs';
await import('../public/icon-registry.js');
test('seedWeaver gives every space and table a lucide: icon that exists in public/vendor/icons', () => {
  const w = seedWeaver(new Weave());
  const svg = (icon) => new URL(`../public/vendor/icons/${icon.slice('lucide:'.length)}.svg`, import.meta.url);
  for (const sp of w.describeSchema().filter((s) => !s.system)) {
    assert.match(sp.icon ?? '', /^lucide:/, `space ${sp.space} has a lucide icon`);
    assert.ok(existsSync(svg(sp.icon)), `${sp.space} icon ${sp.icon} is vendored`);
    for (const t of sp.tables) {
      assert.match(t.icon ?? '', /^lucide:/, `table ${sp.space}/${t.name} has a lucide icon`);
      assert.ok(existsSync(svg(t.icon)), `${sp.space}/${t.name} icon ${t.icon} is vendored`);
    }
  }
  const dev = w.describeSchema().find((s) => s.space === 'Development');
  const icon = (n) => dev.tables.find((t) => t.name === n).icon;
  assert.equal(icon('Issue'), 'lucide:bug');
  assert.equal(icon('Feature'), 'lucide:star');
  assert.equal(icon('Release'), 'lucide:rocket');
});

const WRECKAGE = [
  ['an #ERR', (s) => s.includes('#ERR')],
  ['raw markup', (s) => /<[A-Za-z/!?]/.test(s)],
  ['only punctuation and whitespace', (s) => s.trim() !== '' && !/[\p{L}\p{N}]/u.test(s)],
];

function wreckedCells(w) {
  const bad = [];
  for (const table of ['People', 'Field Types']) {
    const db = w.findTable(`Showcase/${table}`);
    for (const e of w.listEntities(db.id)) {
      const row = w.readEntity(e.id);
      for (const [field, value] of Object.entries(row.fields)) {
        if (typeof value !== 'string') continue;
        for (const [rule, wrecked] of WRECKAGE) {
          if (wrecked(value)) bad.push(`${table} › ${row.name} › ${field} is ${rule}: ${JSON.stringify(value)}`);
        }
      }
    }
  }
  return bad;
}

test('every cell the shipped showcase draws reads as a value, never as wreckage (Issue #580)', () => {
  assert.deepEqual(wreckedCells(seedFieldShowcase(new Weave())), []);
});

test('the showcase Due dates sit ahead of today, so Days left counts down (Issue #580)', () => {
  const w = seedFieldShowcase(new Weave());
  const ft = w.findTable('Showcase/Field Types');
  const rows = w.listEntities(ft.id).map((e) => w.readEntity(e.id));
  const dated = rows.filter((r) => r.raw.Due);
  assert.ok(dated.length >= 3, `three rows carry a Due date (${dated.length})`);
  for (const r of dated) {
    const left = r.fields['Days left'];
    assert.ok(typeof left === 'number' && left > 0, `${r.name}: Days left reads ${JSON.stringify(left)}`);
  }
  for (const r of rows.filter((r) => !r.raw.Due)) {
    assert.equal(r.fields['Days left'], '', `${r.name}: no Due date leaves Days left empty`);
  }
  const bracketed = dated.filter((r) => r.raw.Start);
  assert.ok(bracketed.length >= 2, `two rows run from a Start to a Due (${bracketed.length})`);
  for (const r of bracketed) {
    assert.ok(Date.parse(r.raw.Start) < Date.parse(r.raw.Due), `${r.name}: Start precedes Due`);
    assert.ok(Date.parse(r.raw.Published) <= Date.now(), `${r.name}: Published is already past`);
    assert.deepEqual(r.raw.Window, { start: r.raw.Start, end: r.raw.Due }, `${r.name}: Window brackets Start and Due`);
  }
});
