/* The `rating` field type (Feature #231): a whole number from 0 to the
   field's max, drawn as that many icons you click to fill. The config is
   `{ max, icon }` (max 1..10, the dialog offering 3, 5 and 7; one icon from
   the inventory per field, a star unless said). The value is a number to
   everything that reads it: formulas, sort, filter, CSV, the API. A lookup
   or a rollup over a rating reads its max and icon, so it can draw the same
   icons, read-only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, FIELD_TYPES, DEFINABLE_TYPES, TYPE_MIGRATIONS } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';

function ws(config = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Vendor' });
  const f = w.addField(t, { name: 'Fit', type: 'rating', config });
  return { w, t, f };
}
const described = (w, table, name) => w.describeSchema().find((s) => s.space === 'Ops').tables.find((x) => x.name === table).fields.find((x) => x.name === name);

test('rating is a field type: registered, definable, in the vocabulary, star out of five by default', () => {
  assert.ok(FIELD_TYPES.includes('rating'));
  assert.ok(DEFINABLE_TYPES.includes('rating'));
  const { w, f } = ws();
  assert.deepEqual(f.config, { max: 5, icon: 'lucide:star' }, 'both keys written down, so a reader sees them');
  const vocab = VOCABULARY.fieldTypes.find((x) => x.type === 'rating');
  assert.ok(vocab, 'weave_vocabulary lists it');
  assert.deepEqual(vocab.config, ['max', 'icon', 'default']);
  const d = described(w, 'Vendor', 'Fit');
  assert.equal(d.max, 5);
  assert.equal(d.icon, 'lucide:star');
});

test('max is a whole number 1..10 and the icon comes from the inventory', () => {
  const { w, t } = ws({ max: 7, icon: 'lucide:heart' });
  assert.deepEqual(w.getField(t, 'Fit').config, { max: 7, icon: 'lucide:heart' });
  assert.throws(() => w.addField(t, { name: 'Zero', type: 'rating', config: { max: 0 } }), /A rating's max is a whole number from 1 to 10, got '0'/);
  assert.throws(() => w.addField(t, { name: 'Big', type: 'rating', config: { max: 11 } }), /from 1 to 10/);
  assert.throws(() => w.addField(t, { name: 'Half', type: 'rating', config: { max: 4.5 } }), /from 1 to 10/);
  assert.throws(() => w.addField(t, { name: 'Emoji', type: 'rating', config: { icon: '🔥' } }), /not in the inventory/);
  w.updateField(t, 'Fit', { config: { max: 3 } });
  assert.deepEqual(w.getField(t, 'Fit').config, { max: 3, icon: 'lucide:heart' }, 'one key at a time: the icon keeps');
  w.updateField(t, 'Fit', { config: { icon: 'lucide:flag' } });
  assert.deepEqual(w.getField(t, 'Fit').config, { max: 3, icon: 'lucide:flag' });
});

test('a value is a whole number held to 0..max: rounded, clamped, numeric text accepted', () => {
  const { w, t } = ws();
  const e = w.createEntity(t, { name: 'a', values: { Fit: 3 } });
  const read = () => w.readEntity(e.id);
  assert.equal(read().raw.Fit, 3);
  assert.equal(read().fields.Fit, 3, 'the API returns the number');
  w.updateEntity(e.id, { Fit: 3.6 });
  assert.equal(read().raw.Fit, 4, 'rounded');
  w.updateEntity(e.id, { Fit: 9 });
  assert.equal(read().raw.Fit, 5, 'clamped to max');
  w.updateEntity(e.id, { Fit: -2 });
  assert.equal(read().raw.Fit, 0, 'clamped to 0');
  w.updateEntity(e.id, { Fit: '2' });
  assert.equal(read().raw.Fit, 2);
  w.updateEntity(e.id, { Fit: null });
  assert.equal(read().raw.Fit, null, 'unrated is empty, 0 is a rating of nothing');
  assert.throws(() => w.updateEntity(e.id, { Fit: 'great' }), /'great' is not a rating/);
  // Lowering the max holds every stored value to the new ceiling.
  w.updateEntity(e.id, { Fit: 5 });
  w.updateField(t, 'Fit', { config: { max: 3 } });
  assert.equal(read().raw.Fit, 3);
});

test('a default is a rating like any other', () => {
  const { w, t } = ws({ default: 2 });
  const e = w.createEntity(t, { name: 'a' });
  assert.equal(w.readEntity(e.id).raw.Fit, 2);
  assert.throws(() => w.updateField(t, 'Fit', { config: { default: 'lots' } }), /not a rating/);
});

test('formulas, sort, filter, stats and CSV read a number', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Twice', type: 'formula', config: { expression: '[Fit] * 2' } });
  for (const [name, fit] of [['a', 4], ['b', 1], ['c', 3]]) w.createEntity(t, { name, values: { Fit: fit } });
  const byName = (q) => q.items.map((e) => e.name);
  assert.deepEqual(w.query(t, {}).items.map((e) => e.fields.Twice), [8, 2, 6]);
  assert.deepEqual(byName(w.query(t, { sort: [{ field: 'Fit', dir: 'desc' }] })), ['a', 'c', 'b']);
  assert.deepEqual(byName(w.query(t, { where: [['Fit', '>=', 3]] })), ['a', 'c']);
  assert.equal(w.tableStats(t).columns.find((c) => c.name === 'Fit').kind, 'number');
  const csv = w.exportCSV(t);
  assert.match(csv, /\n1,a,,4,8/);
  const imported = w.importCSV(t, 'Name,Fit\nd,5\ne,2.4\n');
  assert.equal(imported.created, 2);
  assert.deepEqual(byName(w.query(t, { where: [['Fit', '=', 2]] })), ['e'], 'CSV text is rounded like any write');
});

test('number ⇄ rating converts by rounding and clamping', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Vendor' });
  w.addField(t, { name: 'Score', type: 'number' });
  const a = w.createEntity(t, { name: 'a', values: { Score: 3.7 } });
  const b = w.createEntity(t, { name: 'b', values: { Score: 12 } });
  const c = w.createEntity(t, { name: 'c', values: { Score: -1 } });
  const d = w.createEntity(t, { name: 'd' });
  assert.ok(TYPE_MIGRATIONS.number.includes('rating'));
  assert.ok(TYPE_MIGRATIONS.rating.includes('number'));
  w.updateField(t, 'Score', { type: 'rating', config: { max: 5 } });
  assert.equal(w.getField(t, 'Score').type, 'rating');
  assert.deepEqual([a, b, c, d].map((e) => w.readEntity(e.id).raw.Score), [4, 5, 0, null]);
  w.updateField(t, 'Score', { type: 'number' });
  assert.equal(w.getField(t, 'Score').type, 'number');
  assert.deepEqual([a, b, c, d].map((e) => w.readEntity(e.id).raw.Score), [4, 5, 0, null]);
  w.updateField(t, 'Score', { type: 'rating' });
  w.updateField(t, 'Score', { type: 'text' });
  assert.equal(w.readEntity(a.id).raw.Score, '4', 'to text, the number the reader saw');
});

test('a lookup and a rollup over a rating carry its max and icon; the chip and the card carry the rating', () => {
  const { w, t } = ws({ max: 5, icon: 'lucide:heart' });
  const acct = w.createTable({ space: 'Ops', name: 'Account' });
  w.addRelation(t, { name: 'Account', targetDb: acct, cardinality: 'many-to-one', inverseName: 'Vendors' });
  w.addField(acct, { name: 'Avg fit', type: 'rollup', config: { relationField: 'Vendors', targetField: 'Fit', aggregate: 'avg' } });
  w.addField(acct, { name: 'Total fit', type: 'rollup', config: { relationField: 'Vendors', targetField: 'Fit', aggregate: 'sum' } });
  w.addField(t, { name: 'Account name', type: 'lookup', config: { relationField: 'Account', targetField: 'Name' } });
  const acme = w.createEntity(acct, { name: 'Acme' });
  const v1 = w.createEntity(t, { name: 'v1', values: { Fit: 4, Account: acme.id } });
  w.createEntity(t, { name: 'v2', values: { Fit: 3, Account: acme.id } });
  assert.equal(w.readEntity(acme.id).raw['Avg fit'], 3.5, 'the API returns the figure unrounded');
  const avg = described(w, 'Account', 'Avg fit');
  assert.deepEqual(avg.rating, { max: 5, icon: 'lucide:heart' }, 'an average stays on the scale');
  assert.equal(described(w, 'Account', 'Total fit').rating, undefined, 'a sum leaves the scale and draws as a number');
  assert.equal(described(w, 'Vendor', 'Account name').rating, undefined, 'a lookup of a name is not a rating');
  // A lookup straight onto the rating column.
  const back = w.createTable({ space: 'Ops', name: 'Review' });
  w.addRelation(back, { name: 'Vendor', targetDb: t, cardinality: 'many-to-one', inverseName: 'Reviews' });
  w.addField(back, { name: 'Vendor fit', type: 'lookup', config: { relationField: 'Vendor', targetField: 'Fit' } });
  assert.deepEqual(described(w, 'Review', 'Vendor fit').rating, { max: 5, icon: 'lucide:heart' });
  const r = w.createEntity(back, { name: 'r', values: { Vendor: v1.id } });
  assert.equal(w.readEntity(r.id).raw['Vendor fit'], 4);
  const chip = w.renderView(v1.id, 'chip', { config: { fields: ['Fit'] } });
  assert.deepEqual(chip.fields, [{ label: 'Fit', value: '4', rating: { value: 4, max: 5, icon: 'lucide:heart' } }]);
});
