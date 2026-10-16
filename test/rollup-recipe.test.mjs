import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

function fresh(w = new Weave()) {
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deal' });
  w.createTable({ space: 'Dev', name: 'Person' });
  w.createTable({ space: 'Dev', name: 'Account' });
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 5, color: 'icon' } });
  w.addField('Deal', { name: 'Amount', type: 'number', config: { display: 'bar' } });
  w.addField('Person', { name: 'Age', type: 'number' });
  w.addRelation('Deal', { name: 'Account', targetDb: 'Account', cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addRelation('Person', { name: 'Account', targetDb: 'Account', cardinality: 'many-to-one', inverseName: 'People' });
  w.addField('Account', { name: 'Score', type: 'rollup', config: { relationField: 'Deals', targetField: 'Fit', aggregate: 'avg' } });
  w.addField('Account', { name: 'First fit', type: 'lookup', config: { relationField: 'Deals', targetField: 'Fit' } });
  const acme = w.createEntity('Account', { name: 'Acme' });
  w.createEntity('Deal', { name: 'A', values: { Fit: 2, Amount: 10, Account: acme.id } });
  w.createEntity('Deal', { name: 'B', values: { Fit: 5, Amount: 30, Account: acme.id } });
  w.createEntity('Person', { name: 'P', values: { Age: 41, Account: acme.id } });
  return { w, acme };
}
const described = (w, name) => w.describeSchema().find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Account').fields.find((f) => f.name === name);
const lastChange = (w) => w.activityFeed({ entityId: w.getTable('Account').id, kinds: ['field-config-updated'], limit: 1 }).items[0];

test('a rollup repoints by aggregate, by target field and by relation, keeping its place', () => {
  const { w, acme } = fresh();
  const id = w.getField('Account', 'Score').id;
  w.updateField('Account', 'Score', { config: { width: 220, description: 'mean fit' } });
  const order = [...w.getTable('Account').fieldOrder];
  assert.equal(w.readEntity(acme.id).raw.Score, 3.5);
  w.updateField('Account', 'Score', { config: { aggregate: 'max' } });
  assert.equal(described(w, 'Score').aggregate, 'max');
  assert.equal(w.readEntity(acme.id).raw.Score, 5, 'the column recomputes on the new aggregate');
  assert.deepEqual(described(w, 'Score').rating, { max: 5, icon: 'lucide:star', color: 'icon' }, 'max stays on the rating scale');
  w.updateField('Account', 'Score', { config: { targetField: 'Amount', aggregate: 'sum' } });
  assert.equal(w.readEntity(acme.id).raw.Score, 40);
  assert.equal(described(w, 'Score').rating, undefined, 'a sum of amounts is no rating');
  assert.equal(described(w, 'Score').display, 'bar', 'it wears the display of the column it reads now');
  w.updateField('Account', 'Score', { config: { relationField: 'People', targetField: 'Age', aggregate: 'avg' } });
  assert.equal(described(w, 'Score').via, 'People');
  assert.equal(described(w, 'Score').targetField, 'Age');
  assert.equal(w.readEntity(acme.id).raw.Score, 41);
  w.updateField('Account', 'Score', { config: { aggregate: 'count' } });
  assert.equal(w.readEntity(acme.id).raw.Score, 1, 'a count reads no field');
  const f = w.getField('Account', 'Score');
  assert.equal(f.id, id, 'the same column, never a new one');
  assert.equal(f.config.width, 220);
  assert.equal(f.config.description, 'mean fit');
  assert.deepEqual(w.getTable('Account').fieldOrder, order);
});

test('a lookup repoints its field and its relation', () => {
  const { w, acme } = fresh();
  w.updateField('Account', 'First fit', { config: { targetField: 'Amount' } });
  assert.equal(described(w, 'First fit').targetField, 'Amount');
  assert.deepEqual(w.readEntity(acme.id).raw['First fit'], [10, 30]);
  w.updateField('Account', 'First fit', { config: { relationField: 'People', targetField: 'Age' } });
  assert.deepEqual(w.readEntity(acme.id).raw['First fit'], [41]);
});

test('a repoint is refused exactly where a create is refused, and leaves the column as it was', () => {
  const { w } = fresh();
  const refusals = [
    [{ aggregate: 'mean' }, /Invalid aggregate 'mean'/],
    [{ relationField: 'Name' }, /Rollup must point at a relation field/],
    [{ targetField: 'Nope' }, /Nope/],
  ];
  for (const [config, re] of refusals) {
    assert.throws(() => w.addField('Account', { name: 'Probe', type: 'rollup', config: { relationField: 'Deals', targetField: 'Fit', aggregate: 'avg', ...config } }), re, 'a create refuses it');
    assert.throws(() => w.updateField('Account', 'Score', { config }), re, 'so does a repoint');
  }
  assert.throws(() => w.updateField('Account', 'Score', { config: { relationField: 'People' } }), /'Fit' is a field of Deal, not Person: name the targetField/);
  w.updateField('Account', 'Score', { config: { aggregate: 'count' } });
  assert.throws(() => w.addField('Account', { name: 'Probe', type: 'rollup', config: { relationField: 'Deals', aggregate: 'avg' } }), /A rollup that runs avg needs a targetField to read/);
  assert.throws(() => w.updateField('Account', 'Score', { config: { aggregate: 'avg' } }), /A rollup that runs avg needs a targetField to read/);
  assert.throws(() => w.updateField('Account', 'First fit', { config: { relationField: 'Name' } }), /Lookup must point at a relation field/);
  assert.throws(() => w.addField('Account', { name: 'Probe', type: 'lookup', config: { relationField: 'Deals' } }), /A lookup needs a targetField to read/);
  assert.throws(() => w.updateField('Account', 'First fit', { config: { relationField: 'People', targetField: null } }), /A lookup needs a targetField to read/);
  assert.equal(described(w, 'Score').aggregate, 'count');
  assert.equal(described(w, 'First fit').targetField, 'Fit');
  assert.equal(w.findField(w.getTable('Account'), 'Probe'), undefined);
});

test('the same recipe sent back is no change, even by name', () => {
  const { w } = fresh();
  const before = w.activityFeed({ entityId: w.getTable('Account').id, limit: 50 }).items.length;
  w.updateField('Account', 'Score', { config: { relationField: 'Deals', targetField: 'Fit', aggregate: 'avg' } });
  assert.equal(w.activityFeed({ entityId: w.getTable('Account').id, kinds: ['field-config-updated'], limit: 5 }).items.length, 0);
  assert.ok(w.activityFeed({ entityId: w.getTable('Account').id, limit: 50 }).items.length >= before);
});

test('a space rollup stays read-only: its recipe is set from the grid', () => {
  const { w } = fresh();
  const spaces = Object.values(w.state.tables).find((t) => t.system === 'spaces');
  const made = w.addField(spaces.id, { name: 'Deal fit', type: 'rollup', config: { via: 'Deal', targetField: 'Fit', aggregate: 'avg' } });
  assert.throws(() => w.updateField(spaces.id, made.id, { config: { aggregate: 'max' } }), /space rollup.*Σ row/);
  assert.throws(() => w.updateField(spaces.id, made.id, { config: { relationField: 'Deals' } }), /space rollup.*Σ row/);
  w.updateField(spaces.id, made.id, { config: { via: made.config.via, targetField: made.config.targetField, aggregate: 'avg' } });
  assert.equal(w.getField(spaces.id, made.id).config.aggregate, 'avg');
});

test('the audit row names the old and the new recipe, and undo puts the old one back', () => {
  const { w, acme } = fresh();
  w.updateField('Account', 'Score', { config: { targetField: 'Amount', aggregate: 'sum' } });
  const entry = lastChange(w);
  assert.deepEqual(entry.detail.recipe, { before: 'avg(Deals.Fit)', after: 'sum(Deals.Amount)' });
  assert.deepEqual(entry.detail.changed.sort(), ['aggregate', 'targetField']);
  w.rollbackFieldConfig(entry.id, { via: 'undo' });
  assert.equal(described(w, 'Score').aggregate, 'avg');
  assert.equal(described(w, 'Score').targetField, 'Fit');
  assert.equal(w.readEntity(acme.id).raw.Score, 3.5);
  w.updateField('Account', 'First fit', { config: { relationField: 'People', targetField: 'Age' } });
  assert.deepEqual(lastChange(w).detail.recipe, { before: 'Deals.Fit', after: 'People.Age' });
  w.rollbackFieldConfig(lastChange(w).id, { via: 'undo' });
  assert.deepEqual(w.readEntity(acme.id).raw['First fit'], [2, 5]);
});

test('a repoint names the formulas that now fail, and does not block the edit', () => {
  const { w } = fresh();
  w.addField('Account', { name: 'Doubled', type: 'formula', config: { expression: 'Score * 2' } });
  w.addField('Account', { name: 'Label', type: 'formula', config: { expression: 'Name' } });
  w.updateField('Account', 'Score', { config: { aggregate: 'max' } });
  assert.equal(lastChange(w).detail.formulas, undefined, 'a number stays a number: nothing breaks');
  w.updateField('Account', 'Score', { config: { aggregate: 'join' } });
  const { formulas } = lastChange(w).detail;
  assert.equal(described(w, 'Score').aggregate, 'join', 'the repoint lands');
  assert.equal(formulas.length, 1);
  assert.equal(formulas[0].field, 'Doubled');
  assert.equal(formulas[0].rows, 1);
  assert.ok(formulas[0].errors + formulas[0].nulls >= 1);
});

test('PATCH /api/tables/:id/fields/:id repoints and reports the formulas it breaks', async () => {
  const { w } = fresh();
  w.addField('Account', { name: 'Doubled', type: 'formula', config: { expression: 'Score * 2' } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const acc = w.findTable('Dev/Account');
    const f = w.getField('Account', 'Score');
    const patch = (config) => fetch(`http://127.0.0.1:${server.address().port}/api/tables/${acc.id}/fields/${f.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }),
    });
    let r = await patch({ aggregate: 'min' });
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(w.getField('Account', 'Score').config.aggregate, 'min');
    assert.ok(body.activity);
    assert.equal(body.formulas, undefined);
    r = await patch({ aggregate: 'join' });
    body = await r.json();
    assert.deepEqual(body.formulas.map((x) => x.field), ['Doubled']);
    r = await patch({ aggregate: 'mean' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Invalid aggregate 'mean'/);
  } finally { server.close(); }
});

test('weave_update_field repoints a lookup and names the formulas it breaks', () => {
  const { w, acme } = fresh();
  w.addField('Account', { name: 'Doubled', type: 'formula', config: { expression: 'Score * 2' } });
  const out = dispatchTool(w, 'weave_update_field', { db: 'Account', field: 'First fit', config: { targetField: 'Amount' } });
  assert.equal(out.name, 'First fit');
  assert.deepEqual(w.readEntity(acme.id).raw['First fit'], [10, 30]);
  const broke = dispatchTool(w, 'weave_update_field', { db: 'Account', field: 'Score', config: { aggregate: 'join' } });
  assert.deepEqual(broke.formulas.map((x) => x.field), ['Doubled']);
});

test('weave field update repoints a rollup from the terminal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-repoint-'));
  try {
    const data = join(dir, 'ws.db');
    fresh(new Weave({ path: data })).w.save();
    const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const out = JSON.parse(execFileSync(process.execPath, [bin, '--data', data, 'field', 'update', 'Account', 'Score', '--config', '{"aggregate":"max"}'], { encoding: 'utf8' }));
    assert.equal(out.config.aggregate, 'max');
    const w = new Weave({ path: data });
    assert.equal(w.getField('Account', 'Score').config.aggregate, 'max');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
