/* Feature #262: every template's tables, fields and relations are exercised.
   Kyle, 2026-10-05: "confirm add remove link works for all templates and
   template tables and fields as well as use template works to implement
   template in test workspace."

   "All templates" is both kinds: the template spaces kept as fixtures in
   test/fixtures/templates/ (the live CRM template, refreshed from :4400 by
   scripts/template-fixture.mjs) and the three starters in
   public/starter-core.js. Each table goes through exerciseTable()
   (scripts/template-exercise-core.mjs): a row with every writable field read
   back, every relation linked and unlinked from both ends, every lookup,
   rollup and formula checked while linked, trash and restore, and nothing
   left behind. A fixture is then used into a second workspace named `test`
   and its copy passes the same exercise. The last tests run the live script
   over HTTP against an in-process hub, and prove the exercise fails loudly
   when a door lies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Weave, templateDoc } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { exerciseTable, exerciseSpace, engineApi, sampleRow } from '../scripts/template-exercise-core.mjs';
import { runLive } from '../scripts/template-exercise.mjs';

await import('../public/starter-core.js');
const S = globalThis.WeaveStarters;

const FIXTURES = fileURLToPath(new URL('./fixtures/templates/', import.meta.url));
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()
  .map((file) => ({ file, doc: JSON.parse(readFileSync(FIXTURES + file, 'utf8')) }));

/* ids, urls and counts are the source's own: what is left must match. */
function normalise(v) {
  if (Array.isArray(v)) return v.map(normalise);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !['id', 'spaceId', 'url', 'entityCount'].includes(k) && !/Ids?$/.test(k))
    .map(([k, x]) => [k, normalise(x)]));
}
const entryOf = (w, name) => w.describeSchema().find((s) => s.space === name);
const userRows = (w) => Object.values(w.state.entities).filter((e) => !w.state.tables[e.dbId]?.system);

/* A workspace holding one fixture, marked as the template it is on :4400. */
function fromFixture(doc, workspace = 'weave') {
  const w = new Weave();
  w.updateWorkspace({ name: workspace });
  w.applySchema([doc], { partial: true });
  w.updateSpace(doc.space, { template: true });
  return w;
}

/* Every table of `space` exercised as its own subtest, so a red run names
   the template and the table before the field-level lines. */
async function exerciseEvery(t, w, space, label) {
  const api = engineApi(w);
  const schema = await api.schema();
  const entry = schema.find((s) => s.space === space);
  assert.ok(entry?.tables.length, `${label} has tables`);
  const before = userRows(w).length;
  for (const table of entry.tables) {
    await t.test(`${label} › ${table.name}`, async () => {
      const r = await exerciseTable(api, table, { label, schema });
      assert.deepEqual(r.failures, [], `${label} › ${table.name}:\n  ${r.failures.join('\n  ')}`);
      assert.deepEqual(r.skipped, [], `${label} › ${table.name} has fields the exercise cannot write: ${JSON.stringify(r.skipped)}`);
      const fields = table.fields.filter((f) => !['view', 'relation', 'lookup', 'rollup', 'formula'].includes(f.type));
      assert.equal(r.fields, fields.length, 'every writable field was written and read back');
      assert.equal(r.relations, table.fields.filter((f) => f.type === 'relation').length, 'every relation was linked and unlinked');
      assert.equal(r.computed, table.fields.filter((f) => ['lookup', 'rollup', 'formula'].includes(f.type)).length, 'every computed field was checked');
      assert.ok(r.ok);
    });
  }
  assert.equal(userRows(w).length, before, `${label}: the exercise leaves no rows behind`);
}

test('the fixture folder holds the CRM template', () => {
  assert.ok(fixtures.some((f) => f.file === 'crm.json'), 'crm.json is there');
  for (const { file, doc } of fixtures) {
    assert.equal(typeof doc.space, 'string', `${file} is one space`);
    assert.ok(doc.tables.length, `${file} has tables`);
    assert.equal(JSON.stringify(doc).match(/"(spaceId|url|entityCount|targetDbId|inverseFieldId)":/), null, `${file} carries no source ids`);
  }
});

for (const { file, doc } of fixtures) {
  test(`${file}: applies into an empty workspace, describes as itself and is listed as a template`, () => {
    const w = fromFixture(doc);
    assert.deepEqual(w.listTemplates().map((s) => s.name), [doc.space]);
    const again = templateDoc(entryOf(w, doc.space), { name: doc.space });
    assert.deepEqual(again.skipped, []);
    assert.deepEqual(normalise(again.doc), normalise(doc), 'the fixture round-trips through applySchema(partial)');
  });

  test(`${file}: every table adds, links, unlinks, removes and restores`, async (t) => {
    await exerciseEvery(t, fromFixture(doc), doc.space, doc.space);
  });

  test(`${file}: Use template copies it into the test workspace, and the copy passes the same exercise`, async (t) => {
    const src = fromFixture(doc);
    const target = new Weave();
    target.updateWorkspace({ name: 'test' });
    const name = `${doc.space} check`;
    const used = src.useTemplate(doc.space, target, { name });
    assert.deepEqual(used.skipped, [], 'nothing leaves the space');
    assert.equal(used.space.name, name);
    assert.equal('template' in used.space, false, 'the copy is not a template itself');
    assert.deepEqual(normalise(entryOf(target, name)), normalise(templateDoc(entryOf(src, doc.space), { name }).doc), 'the copy describes as the template');
    await exerciseEvery(t, target, name, `test/${name}`);
    assert.equal(userRows(src).length, 0, 'the source gained no rows');
  });
}

for (const tpl of S.TEMPLATES) {
  test(`starter ${tpl.title}: every table of the built space adds, links, unlinks, removes and restores`, async (t) => {
    const w = new Weave();
    const built = w.build(S.spec(tpl));
    assert.ok(built.ok, JSON.stringify(built.errors));
    await exerciseEvery(t, w, tpl.space, `starter ${tpl.title}`);
  });
}

// ---------------- the live script, over HTTP, against an in-process hub

async function hub() {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const weave = fromFixture(fixtures.find((f) => f.file === 'crm.json').doc);
  weave.createSpace({ name: 'Plain' });
  const target = new Weave();
  target.updateWorkspace({ name: 'test' });
  const { server } = await startServer(root, { port: 0, workspaces: { weave, test: target } });
  return { weave, target, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('the live script exercises the template and its copy over HTTP, then soft-deletes the copy', async () => {
  const { weave, target, server, base } = await hub();
  try {
    const lines = [];
    const run = await runLive({ base, from: 'weave', into: 'test', stamp: '20261005-1200', log: (l) => lines.push(l) });
    assert.equal(run.ok, true, lines.join('\n'));
    const [crm] = run.results;
    assert.equal(crm.template, 'CRM');
    assert.equal(crm.copy.name, 'CRM check 20261005-1200');
    const tables = fixtures.find((f) => f.file === 'crm.json').doc.tables.map((x) => x.name);
    assert.deepEqual(crm.reports.filter((r) => r.where === 'weave').map((r) => r.table), tables);
    assert.deepEqual(crm.reports.filter((r) => r.where === 'test').map((r) => r.table), tables);
    assert.ok(crm.reports.every((r) => r.ok && r.relations > 0));
    assert.match(crm.cleanup, /soft-deleted/);
    assert.equal(target.listSpaces().some((s) => s.name === crm.copy.name), false, 'the copy is gone from the live list');
    assert.ok(target.listSpaces({ includeDeleted: true }).some((s) => s.name === crm.copy.name), 'and sits in the trash');
    assert.equal(userRows(weave).length, 0, 'the template is left with no rows');
    assert.ok(lines.some((l) => /^where\s+table\s+fields\s+relations\s+computed\s+ok$/.test(l.split('\n')[0])), 'a table per template is printed');
  } finally { server.close(); }
});

// ---------------- the exercise bites

/* An engine adapter with one door broken: the exercise must name the
   template, table and field, and still leave nothing behind. */
function broken(w, patch) {
  return { ...engineApi(w), ...patch(engineApi(w)) };
}
const crmDoc = () => fixtures.find((f) => f.file === 'crm.json').doc;
const crmTable = (w, name) => entryOf(w, 'CRM').tables.find((t) => t.name === name);

test('a value that does not read back is named with its template, table and field', async () => {
  const w = fromFixture(crmDoc());
  const api = broken(w, (ok) => ({ createRow: (t, values) => ok.createRow(t, { ...values, Value: undefined }) }));
  const r = await exerciseTable(api, crmTable(w, 'Deals'), { label: 'CRM' });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /^CRM › Deals › Value: number wrote 1234\.5, read back null/.test(f)), r.failures.join('\n'));
  assert.equal(userRows(w).length, 0);
  // A formula that answers nothing is a failure of its own.
  const blank = broken(w, (ok) => ({ getRow: async (id) => { const row = await ok.getRow(id); if (row.raw && 'Weighted' in row.raw) row.raw.Weighted = null; return row; } }));
  const f = await exerciseTable(blank, crmTable(w, 'Deals'), { label: 'CRM' });
  assert.deepEqual(f.failures, ['CRM › Deals › Weighted: formula "Value * Probability" answered null']);
  assert.equal(userRows(w).length, 0);
});

test('a link that holds on neither end, and a lookup that never answers, are failures', async () => {
  const w = fromFixture(crmDoc());
  const api = broken(w, () => ({ link: async () => true }));
  const r = await exerciseTable(api, crmTable(w, 'Activities'), { label: 'CRM' });
  for (const want of [/› Contact: link did not hold on this row/, /› Contact: link is missing from the far end Contacts\.Activities/, /› Deal: link did not hold/, /› Company: lookup of Contact\.Company answered null/]) {
    assert.ok(r.failures.some((f) => want.test(f)), `${want}\n${r.failures.join('\n')}`);
  }
  assert.equal(userRows(w).length, 0);
});

test('a soft delete that deletes nothing, and a restore that throws, are failures and cleanup still runs', async () => {
  const w = fromFixture(crmDoc());
  const api = broken(w, () => ({ deleteRow: async (id, opts = {}) => (opts.hard ? w.deleteEntity(id, opts) : { ok: true }), restoreRow: async () => { throw new Error('no restore door'); } }));
  const r = await exerciseTable(api, crmTable(w, 'Companies'), { label: 'CRM' });
  assert.ok(r.failures.includes('CRM › Companies: a deleted row is still listed'), r.failures.join('\n'));
  assert.ok(r.failures.includes('CRM › Companies: a deleted row is not in the trash'));
  assert.ok(r.failures.includes('CRM › Companies: restore threw: no restore door'));
  assert.equal(userRows(w).length, 0, 'hard-delete ran in finally');
});

test('a field type with no sample is reported as skipped, never silently passed', () => {
  const { skipped, written } = sampleRow({ fields: [{ name: 'Name', type: 'text', role: 'name' }, { name: 'Secret', type: 'key' }] }, 'x');
  assert.deepEqual(skipped, [{ field: 'Secret', type: 'key' }]);
  assert.deepEqual(written.map((f) => f.name), ['Name']);
});

test('exerciseSpace walks every table of a space in schema order', async () => {
  const w = fromFixture(crmDoc());
  const reports = await exerciseSpace(engineApi(w), 'CRM');
  assert.deepEqual(reports.map((r) => r.table), crmDoc().tables.map((t) => t.name));
  assert.ok(reports.every((r) => r.ok));
});
