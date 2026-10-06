import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { evaluate, check } from '../src/formula.js';

function sessions(rows) {
  const w = new Weave();
  w.createSpace({ name: 'Agent' });
  const t = w.createTable({ space: 'Agent', name: 'Sessions' });
  w.addField(t.id, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  w.addField(t.id, { name: 'Refund', type: 'number', config: { format: 'currency', currency: 'EUR', decimals: 2, accounting: true } });
  w.addField(t.id, { name: 'Tokens', type: 'number', config: { format: 'compact' } });
  w.addField(t.id, { name: 'Budget', type: 'number', config: { format: 'compact', currency: 'USD' } });
  w.addField(t.id, { name: 'At', type: 'date', config: { time: true, zone: 'instant' } });
  w.addField(t.id, { name: 'Local', type: 'date', config: { time: true, zone: 'fixed', zoneName: 'America/New_York' } });
  for (let i = 0; i < rows.length; i++) w.createEntity(t.id, { values: { Name: `s${i}`, ...rows[i] } });
  const spacesT = Object.values(w.state.tables).find((x) => x.system === 'spaces');
  w.addField(spacesT.id, { name: 'Sessions · Cost · avg', type: 'rollup', config: { via: t.id, targetField: 'Cost', aggregate: 'avg' } });
  w.addField(spacesT.id, { name: 'Sessions · Cost · sum', type: 'rollup', config: { via: t.id, targetField: 'Cost', aggregate: 'sum' } });
  w.addField(spacesT.id, { name: 'Sessions · At · max', type: 'rollup', config: { via: t.id, targetField: 'At', aggregate: 'max' } });
  return { w, t };
}

function countFormatters(fn) {
  const real = { NumberFormat: Intl.NumberFormat, DateTimeFormat: Intl.DateTimeFormat };
  const built = { NumberFormat: 0, DateTimeFormat: 0 };
  for (const k of Object.keys(real)) {
    Intl[k] = class extends real[k] { constructor(...a) { super(...a); built[k]++; } };
  }
  try { return { result: fn(), built }; } finally { Object.assign(Intl, real); }
}

test('number costumes read exactly as before, whichever order the configs are dressed in', () => {
  const rows = [
    { Cost: 1234.5, Refund: -3.5, Tokens: 1234567, Budget: 1500 },
    { Cost: 0, Refund: 12, Tokens: 999, Budget: 2500000 },
    { Cost: -0.004, Refund: -1200.456, Tokens: 12500, Budget: 0.5 },
  ];
  const expected = [
    { Cost: '$1,234.50', Refund: '(€3.50)', Tokens: '1.2M', Budget: '$1.5K' },
    { Cost: '$0.00', Refund: '€12.00', Tokens: '999', Budget: '$2.5M' },
    { Cost: '-$0.00', Refund: '(€1,200.46)', Tokens: '12.5K', Budget: '$0.5' },
  ];
  const { w, t } = sessions(rows);
  for (let pass = 0; pass < 2; pass++) {
    const items = w.query(t.id, { sort: ['Name'] }).items;
    items.forEach((r, i) => {
      for (const [k, v] of Object.entries(expected[i])) assert.equal(r.fields[k], v, `pass ${pass}, row ${i}, ${k}`);
    });
  }
  assert.equal(w.readEntity(w.query(t.id, { where: [['Name', '=', 's2']] }).items[0].id).fields.Refund, '(€1,200.46)');
});

test('instant and fixed-zone dates read exactly as before, zone by zone and across a DST edge', () => {
  const rows = [
    { At: '2026-03-08T09:59Z', Local: '2026-03-08T01:59' },
    { At: '2026-03-08T10:00Z', Local: '2026-03-08T12:00' },
    { At: '2026-08-15T23:30Z', Local: '2026-08-15T16:15' },
  ];
  const { w, t } = sessions(rows);
  const read = (zone) => w.query(t.id, { sort: ['Name'], viewerZone: zone }).items.map((r) => [r.fields.At, r.fields.Local]);
  const la = [
    ['Mar 8, 2026 1:59 AM PST', 'Mar 8, 2026 1:59 AM EST'],
    ['Mar 8, 2026 3:00 AM PDT', 'Mar 8, 2026 12:00 PM EDT'],
    ['Aug 15, 2026 4:30 PM PDT', 'Aug 15, 2026 4:15 PM EDT'],
  ];
  const tokyo = [
    ['Mar 8, 2026 6:59 PM GMT+9', 'Mar 8, 2026 1:59 AM EST'],
    ['Mar 8, 2026 7:00 PM GMT+9', 'Mar 8, 2026 12:00 PM EDT'],
    ['Aug 16, 2026 8:30 AM GMT+9', 'Aug 15, 2026 4:15 PM EDT'],
  ];
  assert.deepEqual(read('America/Los_Angeles'), la);
  assert.deepEqual(read('Asia/Tokyo'), tokyo);
  assert.deepEqual(read('America/Los_Angeles'), la);
  assert.deepEqual(read(null).map(([at]) => at), ['Mar 8, 2026 9:59 AM UTC', 'Mar 8, 2026 10:00 AM UTC', 'Aug 15, 2026 11:30 PM UTC']);
});

test('a bad currency or zone still fails the way it did: refused at definition, never cached', () => {
  const { w, t } = sessions([]);
  assert.throws(() => w.addField(t.id, { name: 'Bad', type: 'number', config: { format: 'currency', currency: 'XX1' } }), /not a currency code/);
  assert.throws(() => w.addField(t.id, { name: 'Bad zone', type: 'date', config: { time: true, zone: 'fixed', zoneName: 'Mars/Olympus' } }));
});

test('the stats report and a page of rows build a fixed number of formatters, not one per value', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    Cost: i / 7, Refund: -i, Tokens: i * 1000, Budget: i * 50,
    At: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:15Z`,
    Local: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T08:00`,
  }));
  const { w, t } = sessions(rows);
  const stats = countFormatters(() => w.tableStats(t.id));
  assert.equal(stats.result.rows, 400);
  assert.equal(stats.result.rollups.find((r) => r.name === 'Sessions · Cost · avg').display, '$28.50');
  assert.ok(stats.built.NumberFormat <= 8, `tableStats built ${stats.built.NumberFormat} NumberFormats for 400 rows`);
  assert.ok(stats.built.DateTimeFormat <= 8, `tableStats built ${stats.built.DateTimeFormat} DateTimeFormats for 400 rows`);
  const page = countFormatters(() => w.query(t.id, { limit: 200, viewerZone: 'Europe/Berlin' }));
  assert.equal(page.result.items.length, 200);
  assert.ok(page.built.NumberFormat <= 8, `a page of 200 built ${page.built.NumberFormat} NumberFormats`);
  assert.ok(page.built.DateTimeFormat <= 8, `a page of 200 built ${page.built.DateTimeFormat} DateTimeFormats`);
});

test('a formula read on many rows answers each row from its own values, and a broken one stays broken', () => {
  const { w, t } = sessions(Array.from({ length: 50 }, (_, i) => ({ Cost: i, Tokens: i * 3 })));
  w.addField(t.id, { name: 'Per token', type: 'formula', config: { expression: 'if([Tokens] > 0, [Cost] / [Tokens], 0)' } });
  for (let pass = 0; pass < 2; pass++) {
    for (const r of w.query(t.id).items) {
      const i = Number(r.fields.Name.slice(1));
      assert.equal(r.raw['Per token'], i ? 1 / 3 : 0, `pass ${pass}, ${r.fields.Name}`);
    }
  }
  assert.equal(evaluate('[a] * 2 + 1', (n) => ({ a: 5 })[n]), 11);
  assert.equal(evaluate('[a] * 2 + 1', (n) => ({ a: -1 })[n]), -1);
  for (let k = 0; k < 2; k++) {
    assert.deepEqual(check('[Cost] + "open', ['Cost']), { ok: false, error: 'Unclosed string' });
    assert.deepEqual(check('[Cost] + 1', ['Cost']), { ok: true });
  }
});

test('a zone spelled many ways keeps one formatter, and distinct zones never grow the caches past the cap', () => {
  const DG = globalThis.weaveDateGrain;
  const at = new Date(Date.UTC(2026, 7, 15, 23, 30));
  const zone = 'America/New_York';
  const wall = DG.wallIn(at, zone);
  const abbr = DG.zoneAbbr(at, zone);
  const before = DG.zoneCaches();
  const letters = [...zone];
  for (let k = 1; k < 3000; k++) {
    const spelled = letters.map((ch, i) => ((k >> (i % 12)) & 1 ? ch.toUpperCase() : ch.toLowerCase())).join('');
    assert.ok(DG.isZone(spelled), spelled);
    assert.deepEqual(DG.wallIn(at, spelled), wall, spelled);
    assert.equal(DG.zoneAbbr(at, spelled), abbr, spelled);
  }
  const after = DG.zoneCaches();
  assert.equal(after.wall, before.wall, 'case variants of one zone built more wall-clock formatters');
  assert.equal(after.abbr, before.abbr, 'case variants of one zone built more abbreviation formatters');
  assert.ok(after.canon <= DG.ZONE_CAP, `${after.canon} spellings kept`);

  const zones = [...Intl.supportedValuesOf('timeZone')];
  for (let m = -14 * 60; m <= 14 * 60; m += 15) {
    const a = Math.abs(m);
    zones.push(`${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`);
  }
  let peak = 0;
  for (const z of zones) {
    const direct = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' })
      .formatToParts(at).find((x) => x.type === 'timeZoneName')?.value ?? z;
    assert.equal(DG.zoneAbbr(at, z), direct, z);
    assert.equal(DG.fromInstant('2026-08-15T23:30Z', z) != null, true, z);
    const c = DG.zoneCaches();
    peak = Math.max(peak, ...Object.values(c));
  }
  assert.ok(zones.length > 500, `only ${zones.length} zones to try`);
  assert.ok(peak <= DG.ZONE_CAP, `a zone cache held ${peak} entries after ${zones.length} distinct zones`);
});
