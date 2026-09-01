import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/formula.js';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* ---------- check(): static validation, no row needed ---------- */

const NAMES = ['Amount', 'Close Date', 'Stage', 'Name'];

test('check accepts a valid expression', () => {
  assert.deepEqual(check('if(Amount > 5, "big", "small")', NAMES), { ok: true });
  assert.deepEqual(check('[Close Date]', NAMES), { ok: true });
  assert.deepEqual(check('concat(Name, PublicId)', NAMES), { ok: true });
});

test('check rejects syntax errors with a message', () => {
  assert.equal(check('if(upper(', NAMES).ok, false);
  assert.match(check('if(upper(', NAMES).error, /Unexpected end/);
  assert.equal(check('1 +', NAMES).ok, false);
  assert.equal(check('[Amount', NAMES).ok, false);
  assert.match(check('[Amount', NAMES).error, /Unclosed/);
  assert.equal(check('Amount Amount', NAMES).ok, false);
});

test('check rejects unknown functions and fields by name', () => {
  const fn = check('quarter(Amount)', NAMES);
  assert.equal(fn.ok, false);
  assert.match(fn.error, /Unknown function 'quarter'/);
  const fld = check('Amont * 2', NAMES);
  assert.equal(fld.ok, false);
  assert.match(fld.error, /Unknown field 'Amont'/);
});

test('check rejects an empty expression', () => {
  assert.equal(check('', NAMES).ok, false);
  assert.equal(check('   ', NAMES).ok, false);
});

/* ---------- engine: invalid formulas cannot be saved ---------- */

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  return { w, t };
}

test('addField rejects a formula that does not parse', () => {
  const { w, t } = seeded();
  assert.throws(() => w.addField(t.id, { name: 'Bad', type: 'formula', config: { expression: 'if(upper(' } }), /Unexpected end/);
});

test('addField rejects a formula naming an unknown field', () => {
  const { w, t } = seeded();
  assert.throws(() => w.addField(t.id, { name: 'Bad', type: 'formula', config: { expression: 'Amont * 2' } }), /Unknown field 'Amont'/);
});

test('updateField rejects a self-referencing formula', () => {
  const { w, t } = seeded();
  const f = w.addField(t.id, { name: 'Health', type: 'formula', config: { expression: 'Amount * 2' } });
  assert.throws(() => w.updateField(t.id, f.id, { config: { expression: 'Health + 1' } }), /Unknown field 'Health'/);
});

test('a valid formula still saves and computes', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'Double', type: 'formula', config: { expression: 'Amount * 2' } });
  const e = w.createEntity(t.id, { Name: 'Acme', Amount: 21 });
  assert.equal(w.readEntity(e.id).fields.Double, 42);
});

/* ---------- engine.checkFormula: the agent verify loop ---------- */

test('checkFormula validates and previews against a real row', () => {
  const { w, t } = seeded();
  w.createEntity(t.id, { Name: 'Acme', Amount: 21 });
  const good = w.checkFormula(t.id, 'Amount * 2');
  assert.equal(good.ok, true);
  assert.equal(good.preview, 42);
  assert.equal(good.previewEntity, 'Acme');
  const bad = w.checkFormula(t.id, 'if(upper(');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected end/);
});

test('checkFormula on an empty table validates without a preview', () => {
  const { w, t } = seeded();
  const r = w.checkFormula(t.id, 'Amount * 2');
  assert.equal(r.ok, true);
  assert.equal('preview' in r, false);
});

/* ---------- REST: POST /api/tables/:id/formula-check ---------- */

let base, server;
test.before(async () => {
  const weave = new Weave();
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
  const api = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  await api('POST', '/api/spaces', { name: 'Sales' });
  await api('POST', '/api/tables', { space: 'Sales', name: 'Deals' });
  await api('POST', '/api/tables/Deals/fields', { name: 'Amount', type: 'number' });
  await api('POST', '/api/tables/Deals/entities', { Name: 'Acme', Amount: 21 });
});
test.after(() => server.close());

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

test('formula-check endpoint: ok with preview', async () => {
  const r = await post('/api/tables/Deals/formula-check', { expression: 'Amount * 2' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.preview, 42);
});

test('formula-check endpoint: invalid comes back 200 with the error, not a 500', async () => {
  const r = await post('/api/tables/Deals/formula-check', { expression: 'if(upper(' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /Unexpected end/);
});

test('field create over REST rejects an invalid expression with 4xx', async () => {
  const r = await post('/api/tables/Deals/fields', { name: 'Bad', type: 'formula', config: { expression: 'if(upper(' } });
  assert.equal(r.status, 400);
});
