import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed } from '../scripts/seed.mjs';

test('demo seed builds a coherent workspace', () => {
  const w = new Weave();
  const { apollo, t3, ada } = seed(w);

  // Rollups across the seeded graph.
  const proj = w.readEntity(apollo.id);
  assert.equal(proj.fields['Task Count'], 3);
  assert.equal(proj.fields['Total Estimate'], 24);
  assert.match(proj.fields['Task List'], /Design onboarding wizard/);

  // Automation fired when t3 hit Done.
  const done = w.readEntity(t3.id);
  assert.match(done.doc, /✅ Completed on \d{4}-\d{2}-\d{2}/);
  assert.ok(done.comments.some((c) => c.text.includes('moved to Done')));

  // Lookup + formula computed.
  assert.equal(done.fields['Project Budget'], 120000);
  assert.equal(done.fields.Size, 'small');

  // Person rollup over assigned tasks.
  assert.equal(w.readEntity(ada.id).fields['Open Load'], 16);

  // Mentions resolve in HTML.
  const schema = w.describeSchema();
  // Demo spaces + the Workspace system space (Feature #12).
  assert.equal(schema.filter((sp) => !sp.system).length, 2);
  assert.equal(schema.filter((sp) => sp.system).length, 1);
});

/* ---------- Showcase space (2026-08-23) ----------
   The weave workspace carries a Showcase space whose Field Types table has
   every field type, with several configurations of the same type side by
   side, so the range of what a field can be is visible in one grid. */
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
  assert.equal(new Set(ofType('number').map((f) => `${f.format ?? 'number'}|${f.unit ?? ''}|${f.decimals ?? ''}`)).size, ofType('number').length, 'every number field is a distinct configuration');
  assert.ok(ofType('date').length >= 3, 'date: iso, us, long+time');
  assert.ok(ofType('select').length >= 2 && ofType('select').some((f) => f.optionsFull.some((o) => o.color)), 'select: colored and plain');
  assert.ok(ofType('workflow').length >= 2, 'workflow: full lifecycle and a two-state gate');
  assert.ok(ofType('rollup').length >= 3, 'rollup: count, an aggregate, a join');
  assert.ok(ofType('formula').length >= 3, 'formula: numeric, text, date');
  assert.ok(ofType('field').length >= 2, 'field: depth 1 and a nested definition');
  assert.ok(ofType('relation').length >= 2, 'relation: single and many');
  // Rows exist and the computed columns resolve on them.
  const rows = w.listEntities(ft.id).map((e) => w.readEntity(e.id));
  assert.ok(rows.length >= 3);
  // readEntity wears the display costume (currency strings), so the check
  // is against the seeded numbers: 149.5 × 12.
  const rich = rows.find((r) => r.name === 'Sensor board');
  assert.equal(rich.fields.Total, 1794, 'a numeric formula over two number configs');
  assert.match(String(rich.fields.Price), /149\.50/, 'currency config renders 2 decimals');
  assert.ok(rows.some((r) => r.fields['Peer count'] >= 2), 'a rollup over a many relation');
});

test('seedFieldShowcase is idempotent — a second run is a no-op', () => {
  const w = seedWeaver(new Weave());
  const before = w.describeSchema().find((s) => s.space === 'Showcase').tables.length;
  seedFieldShowcase(w);
  assert.equal(w.describeSchema().filter((s) => s.space === 'Showcase').length, 1);
  assert.equal(w.describeSchema().find((s) => s.space === 'Showcase').tables.length, before);
});

/* ---------- Every seeded space and table wears a Lucide icon (Issue #203) ----------
   Development/Release seeded blank, Issue as a legacy alias, Feature as a
   glyph; the Handbook rule is that every table carries a `lucide:*` icon from
   the vendored set. The gate walks whatever the seed builds, so a table added
   later without an icon fails here rather than shipping a blank. */
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
