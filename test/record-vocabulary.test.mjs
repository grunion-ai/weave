import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, ONTOLOGY } from '../src/engine.js';
import '../public/term-core.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const T = globalThis.WeaveTerm;

test('a table with no term of its own says record', () => {
  assert.deepEqual(T.DEFAULT, { singular: 'record', plural: 'records' });
  assert.equal(T.count(2), '2 records');
  const w = new Weave();
  w.createSpace({ name: 'Money' });
  const db = w.createTable({ space: 'Money', name: 'Month' });
  assert.deepEqual(w.termOf(db), { singular: 'record', plural: 'records', set: false });
});

test('row stays in the picker for a table that wants it', () => {
  assert.ok(T.options().some((o) => o.id === 'row'));
  const w = new Weave();
  w.createSpace({ name: 'Money' });
  const db = w.createTable({ space: 'Money', name: 'Month' });
  w.updateTable(db, { noun: 'row' });
  assert.equal(w.termOf(w.getTable(db.id)).singular, 'row');
});

test('the data level of the ontology is Record, and row is an alias', () => {
  assert.ok(ONTOLOGY.levels.some((l) => l.key === 'record' && l.name === 'Record'));
  assert.ok(!ONTOLOGY.levels.some((l) => l.key === 'row'));
  assert.ok(ONTOLOGY.aliases.includes('row'));
  assert.ok(!ONTOLOGY.aliases.includes('record'));
  assert.ok(read('docs/ONTOLOGY.md').includes('| **Record** | the data itself |'));
});

test('the primer never makes a record a table', () => {
  assert.doesNotMatch(read('src/mcp-primer.md'), /records become tables/);
});

test('the ontology page settles what it used to contradict', () => {
  const doc = read('docs/ONTOLOGY.md').replace(/\s+/g, ' ');
  assert.doesNotMatch(doc, /workspace is state rather than an entity/);
  assert.doesNotMatch(doc, /Nineteen of them/);
  assert.doesNotMatch(doc, /but not entities: nothing here has fields/);
  for (const table of ['System/Views', 'System/Users', 'System/Forms']) assert.ok(doc.includes(table), `${table} is never named`);
});

test('a build spec takes records, and rows still works', () => {
  for (const key of ['records', 'rows']) {
    const w = new Weave();
    const r = w.build({ spaces: [{ name: 'Sales', tables: [{ name: 'Deal', [key]: [{ Name: 'Acme' }, { Name: 'Globex' }] }] }] });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.ignored, []);
    assert.equal(r.created.rows, 2);
    assert.deepEqual(w.listEntities(w.findTable('Sales/Deal').id).map((e) => w.entityName(e)).sort(), ['Acme', 'Globex']);
  }
});
