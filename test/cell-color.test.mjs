import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave, CELL_COLORS } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deal' });
  return w;
}
const field = (w, name, table = 'Deal') => w.describeSchema().find((s) => s.space === 'Dev').tables.find((t) => t.name === table).fields.find((f) => f.name === name);

test('the colours are ink, icon and accent, in that order', () => {
  assert.deepEqual(CELL_COLORS, ['ink', 'icon', 'accent']);
});

test('a rating, a number display and a formula display take a colour; ink is the default and is not stored', () => {
  const w = fresh();
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 5 } });
  w.addField('Deal', { name: 'Hot', type: 'rating', config: { max: 5, icon: 'lucide:heart', color: 'icon' } });
  w.addField('Deal', { name: 'Bar', type: 'number', config: { display: 'bar', color: 'accent' } });
  w.addField('Deal', { name: 'Ring', type: 'number', config: { display: 'ring' } });
  w.addField('Deal', { name: 'Plain', type: 'number' });
  w.addField('Deal', { name: 'Trend', type: 'formula', config: { expression: '[Bar] * 2', display: 'heat', color: 'icon' } });
  w.addField('Deal', { name: 'Inked', type: 'number', config: { display: 'bar', color: 'ink' } });
  const cfg = (name) => w.getField('Deal', name).config;
  assert.equal(cfg('Fit').color, undefined, 'ink is the default and is not written down');
  assert.equal(cfg('Inked').color, undefined, 'an explicit ink is the default too');
  assert.equal(cfg('Hot').color, 'icon');
  assert.equal(cfg('Bar').color, 'accent');
  assert.equal(cfg('Trend').color, 'icon');
  assert.equal(field(w, 'Fit').color, 'ink');
  assert.equal(field(w, 'Hot').color, 'icon');
  assert.equal(field(w, 'Bar').color, 'accent');
  assert.equal(field(w, 'Ring').color, 'ink');
  assert.equal(field(w, 'Trend').color, 'icon');
  assert.equal(field(w, 'Plain').color, undefined, 'a plain number draws nothing and names no colour');
});

test('an unknown colour is refused with the list', () => {
  const w = fresh();
  assert.throws(() => w.addField('Deal', { name: 'A', type: 'rating', config: { color: 'rainbow' } }), /Invalid color 'rainbow' \(ink, icon, accent\)/);
  assert.throws(() => w.addField('Deal', { name: 'B', type: 'number', config: { display: 'bar', color: 'red' } }), /Invalid color 'red' \(ink, icon, accent\)/);
  assert.throws(() => w.addField('Deal', { name: 'C', type: 'formula', config: { expression: '1', color: 7 } }), /Invalid color '7'/);
});

test('updateField sets the colour and a null puts it back to ink; the other keys keep', () => {
  const w = fresh();
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 7, icon: 'lucide:star' } });
  w.addField('Deal', { name: 'Bar', type: 'number', config: { display: 'bar', scale: 10 } });
  w.updateField('Deal', 'Fit', { config: { color: 'icon' } });
  assert.deepEqual(w.getField('Deal', 'Fit').config, { max: 7, icon: 'lucide:star', color: 'icon' });
  w.updateField('Deal', 'Fit', { config: { max: 10 } });
  assert.equal(w.getField('Deal', 'Fit').config.color, 'icon', 'a max change keeps the colour');
  w.updateField('Deal', 'Fit', { config: { color: null } });
  assert.deepEqual(w.getField('Deal', 'Fit').config, { max: 10, icon: 'lucide:star' });
  w.updateField('Deal', 'Bar', { config: { color: 'accent' } });
  assert.deepEqual(w.getField('Deal', 'Bar').config, { display: 'bar', scale: 10, color: 'accent' });
  w.updateField('Deal', 'Bar', { config: { color: null } });
  assert.deepEqual(w.getField('Deal', 'Bar').config, { display: 'bar', scale: 10 });
  assert.throws(() => w.updateField('Deal', 'Bar', { config: { color: 'plaid' } }), /Invalid color 'plaid'/);
  assert.throws(() => w.updateField('Deal', 'Fit', { config: { color: 'plaid' } }), /Invalid color 'plaid'/);
});

test('a lookup and a rollup draw in the colour of the column they read', () => {
  const w = fresh();
  w.createTable({ space: 'Dev', name: 'Account' });
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 5, icon: 'lucide:star', color: 'icon' } });
  w.addField('Deal', { name: 'Progress', type: 'number', config: { display: 'bar', color: 'accent' } });
  w.addRelation('Deal', { name: 'Account', targetDb: 'Account', cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField('Account', { name: 'Avg fit', type: 'rollup', config: { relationField: 'Deals', targetField: 'Fit', aggregate: 'avg' } });
  w.addField('Account', { name: 'Avg progress', type: 'rollup', config: { relationField: 'Deals', targetField: 'Progress', aggregate: 'avg' } });
  w.addField('Deal', { name: 'Account fits', type: 'lookup', config: { relationField: 'Account', targetField: 'Avg fit' } });
  assert.deepEqual(field(w, 'Avg fit', 'Account').rating, { max: 5, icon: 'lucide:star', color: 'icon' });
  assert.equal(field(w, 'Avg progress', 'Account').color, 'accent');
  w.updateField('Deal', 'Fit', { config: { color: 'accent' } });
  assert.equal(field(w, 'Avg fit', 'Account').rating.color, 'accent', 'the rollup follows its target');
});

test('the chip and the card carry the colour with the graphic', () => {
  const w = fresh();
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 5, color: 'icon' } });
  w.addField('Deal', { name: 'Progress', type: 'number', config: { display: 'ring', color: 'accent' } });
  w.addField('Deal', { name: 'Plain', type: 'number', config: { display: 'bar' } });
  const e = w.createEntity('Deal', { name: 'Big', values: { Fit: 4, Progress: 3, Plain: 2 } });
  const card = w.renderView(e.id, 'card', { config: { fields: ['Fit', 'Progress', 'Plain'] } });
  assert.equal(card.fields.find((s) => s.label === 'Fit').rating.color, 'icon');
  assert.equal(card.fields.find((s) => s.label === 'Progress').meter.color, 'accent');
  assert.equal(card.fields.find((s) => s.label === 'Plain').meter.color, 'ink');
});

test('a schema document round-trips the colour', () => {
  const w = fresh();
  w.addField('Deal', { name: 'Fit', type: 'rating', config: { max: 5, color: 'icon' } });
  w.addField('Deal', { name: 'Progress', type: 'number', config: { display: 'bar', color: 'accent' } });
  const doc = w.describeSchema();
  const w2 = new Weave();
  w2.applySchema(doc);
  assert.equal(w2.getField('Deal', 'Fit').config.color, 'icon');
  assert.equal(w2.getField('Deal', 'Progress').config.color, 'accent');
  assert.deepEqual(w2.applySchema(w2.describeSchema(), { dryRun: true }), [], 'applying it again is a no-op');
});

test('the HTTP API adds, returns and updates the colour', async () => {
  const w = fresh();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  try {
    const deal = w.findTable('Dev/Deal');
    const add = await call('POST', `/tables/${deal.id}/fields`, { name: 'Fit', type: 'rating', config: { max: 5, color: 'accent' } });
    assert.equal(add.status < 300, true, JSON.stringify(add.body));
    const bad = await call('POST', `/tables/${deal.id}/fields`, { name: 'Bad', type: 'rating', config: { color: 'mauve' } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Invalid color 'mauve'/);
    const schema = (await call('GET', '/schema')).body;
    const fit = schema.find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Deal').fields.find((f) => f.name === 'Fit');
    assert.equal(fit.color, 'accent');
    const up = await call('PATCH', `/tables/${deal.id}/fields/${fit.id}`, { config: { color: 'icon' } });
    assert.equal(up.status < 300, true, JSON.stringify(up.body));
    assert.equal(w.getField('Deal', 'Fit').config.color, 'icon');
  } finally { server.close(); }
});

test('the vocabulary, the field dialog and the cell drawing name the same colours', async () => {
  const { VOCABULARY } = await import('../src/vocabulary.js');
  assert.deepEqual(VOCABULARY.cellColors, CELL_COLORS);
  for (const t of ['number', 'rating', 'formula']) {
    assert.ok(VOCABULARY.fieldTypes.find((r) => r.type === t).config.includes('color'), `${t} lists color as a config key`);
  }
  const dialog = readFileSync(join(ROOT, 'public/field-dialog-core.js'), 'utf8');
  assert.deepEqual(JSON.parse(dialog.match(/CELL_COLORS = (\[[^\]]*\])/)[1].replace(/'/g, '"')), CELL_COLORS);
  await import('../public/cell-graphics.js');
  assert.deepEqual(globalThis.weaveCellGraphics.COLORS, CELL_COLORS);
});
