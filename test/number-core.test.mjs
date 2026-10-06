import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
await import('../public/number-core.js');
const nc = globalThis.weaveNumberCore;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test("the sample draws the column's own smallest, middle and largest figures", () => {
  const { values, example } = nc.sampleFigures({ n: 3, min: 15, median: 72, max: 100 }, 'column');
  assert.deepEqual(values, [15, 72, 100]);
  assert.equal(example, false, 'these are the field values, not examples');
});

test('a fixed scale samples the same figures: the scale moves, the values do not', () => {
  assert.deepEqual(nc.sampleFigures({ n: 3, min: 15, median: 72, max: 100 }, 200).values, [15, 72, 100]);
});

test('identical figures collapse, so a one-row column draws one bar and not three of the same', () => {
  assert.deepEqual(nc.sampleFigures({ n: 1, min: 4, median: 4, max: 4 }, 'column').values, [4]);
  assert.deepEqual(nc.sampleFigures({ n: 2, min: 0, median: 0, max: 2 }, 'column').values, [0, 2]);
});

test('float noise never reaches the reader', () => {
  const { values } = nc.sampleFigures({ min: 0.1, median: 10.000000000000002, max: 62.333333333333336 }, 'column');
  assert.deepEqual(values, [0.1, 10, 62.3333]);
});

test('a column with no numbers in it falls back to examples in the costume\'s own range', () => {
  assert.deepEqual(nc.sampleFigures(null, 'column'), { values: [25, 60, 100], example: true });
  assert.deepEqual(nc.sampleFigures({ n: 0, min: null, median: null, max: null }, 'column'), { values: [25, 60, 100], example: true });
  assert.deepEqual(nc.sampleFigures(null, 'column', { format: 'percent' }), { values: [0.25, 0.6, 1], example: true }, 'a percent lives in 0..1');
  assert.deepEqual(nc.sampleFigures(null, 200), { values: [50, 120, 200], example: true }, 'a quarter, three fifths and the whole of a fixed scale');
});

test("100% in the sample is the fixed scale, or the column's largest value", () => {
  assert.equal(nc.sampleScale({ max: 100 }, 'column'), 100);
  assert.equal(nc.sampleScale({ max: 100 }, 5), 5, 'a fixed scale wins');
  assert.equal(nc.sampleScale(null, 'column'), 100, 'nothing to measure against yet');
  assert.equal(nc.sampleScale(null, 'column', { format: 'percent' }), 1);
  assert.equal(nc.sampleScale({ max: 0 }, 'column'), 100, 'a column of zeroes draws nothing');
  assert.equal(nc.sampleScale({ max: -4 }, 'column', { format: 'percent' }), 1, 'a column that only goes down draws nothing');
});

test('the costume dresses a sampled figure the way the grid cell dresses the value', () => {
  assert.equal(nc.dressNumber({ format: 'percent' }, 0.25), '25%');
  assert.equal(nc.dressNumber({ format: 'currency', currency: 'USD' }, 1200), '$1,200.00');
  assert.equal(nc.dressNumber({ format: 'compact', decimals: 1 }, 1200000), '1.2M');
  assert.equal(nc.dressNumber({ unit: 'kg', decimals: 1 }, 2), '2.0 kg');
  assert.equal(nc.dressNumber({}, 72), 72, 'no costume at all: the raw number, untouched');
});

test('number-core.js parses as a classic script', () => {
  assert.doesNotThrow(() => new Function(readFileSync(join(ROOT, 'public/number-core.js'), 'utf8')));
});
