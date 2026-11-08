import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCostume, putCostume, Weave } from '../src/engine.js';

test('pickCostume copies only the listed keys that hold a value, in list order', () => {
  const into = { kept: 1 };
  const out = pickCostume({ format: 'percent', decimals: null, unit: 'kg', stray: true }, ['unit', 'decimals', 'format'], into);
  assert.equal(out, into);
  assert.deepEqual(Object.entries(out), [['kept', 1], ['unit', 'kg'], ['format', 'percent']]);
});

test('putCostume writes values, deletes nulls, and leaves untouched keys alone', () => {
  const config = { format: 'plain', unit: 'kg', grain: ['year'] };
  putCostume(config, ['format', 'unit', 'grain'], { format: 'percent', unit: null, grain: ['day'] }, (k) => k !== 'grain');
  assert.deepEqual(config, { format: 'percent', grain: ['year'] });
});

test('a number costume survives describeSchema and applySchema in both directions', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Deal' });
  w.addField('Deal', { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'EUR', decimals: 2 } });
  w.addField('Deal', { name: 'Due', type: 'date', config: { grain: ['year', 'month', 'day'], time: true } });
  const doc = w.describeSchema();
  const fresh = new Weave();
  fresh.applySchema(doc);
  const fields = (x) => x.describeSchema().find((s) => s.space === 'Ops').tables[0].fields.filter((f) => ['Amount', 'Due'].includes(f.name)).map(({ id, ...rest }) => rest);
  assert.deepEqual(fields(fresh), fields(w));
});
