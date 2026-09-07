/* src/stats.js is the one place a number is summarised. The engine's rollup
   resolver, the table stats report and the grid footer all read it, so a
   median computed three ways cannot disagree. Zero imports: the browser
   bundle reads the same file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, describeNumbers, histogram, distribution, NUMERIC_AGGREGATES, COUNTING_AGGREGATES } from '../src/stats.js';

test('sum / avg / min / max / range over a mixed list ignore what is not a number', () => {
  const vals = [1.5, 2.5, null, 10, 'x', undefined];
  assert.equal(aggregate('sum', vals), 14);
  assert.equal(aggregate('avg', vals), 14 / 3);
  assert.equal(aggregate('min', vals), 1.5);
  assert.equal(aggregate('max', vals), 10);
  assert.equal(aggregate('range', vals), 8.5);
});

test('median is the middle value, or the mean of the two middles', () => {
  assert.equal(aggregate('median', [3, 1, 2]), 2);
  assert.equal(aggregate('median', [4, 1, 3, 2]), 2.5);
  assert.equal(aggregate('median', [null, 'a']), null);
});

test('stdev is the sample standard deviation; fewer than two numbers is null', () => {
  assert.equal(aggregate('stdev', [2, 4, 4, 4, 5, 5, 7, 9]).toFixed(4), '2.1381');
  assert.equal(aggregate('stdev', [7]), null);
  assert.equal(aggregate('stdev', []), null);
});

test('count / filled / empty / distinct count rows, not numbers', () => {
  const vals = ['a', 'b', 'a', null, '', ['x', 'y'], ['y']];
  assert.equal(aggregate('count', vals), 7);
  assert.equal(aggregate('filled', vals), 5);
  assert.equal(aggregate('empty', vals), 2);
  // distinct flattens lists: a, b, x, y
  assert.equal(aggregate('distinct', vals), 4);
});

test('min / max fall back to lexical order when nothing is a number — ISO dates sort themselves', () => {
  const dates = ['2026-09-07', '2026-08-31', null, '2026-09-01'];
  assert.equal(aggregate('min', dates), '2026-08-31');
  assert.equal(aggregate('max', dates), '2026-09-07');
  assert.equal(aggregate('range', dates), null);
});

test('join concatenates display values with the separator', () => {
  assert.equal(aggregate('join', [1, 2], { display: ['one', 'two'] }), 'one, two');
  assert.equal(aggregate('join', [1, null, 2], { display: ['one', null, 'two'], separator: ' / ' }), 'one / two');
});

test('an empty list sums to zero and averages to nothing', () => {
  assert.equal(aggregate('sum', []), 0);
  assert.equal(aggregate('avg', []), null);
  assert.equal(aggregate('min', []), null);
  assert.equal(aggregate('count', []), 0);
});

test('an unknown aggregate throws rather than answering null', () => {
  assert.throws(() => aggregate('mode', [1]), /Unknown aggregate 'mode'/);
});

test('the two aggregate families partition the list and name every aggregate once', () => {
  const all = [...NUMERIC_AGGREGATES, ...COUNTING_AGGREGATES, 'join'];
  assert.deepEqual([...new Set(all)].length, all.length);
  assert.ok(NUMERIC_AGGREGATES.includes('median') && NUMERIC_AGGREGATES.includes('stdev'));
  assert.ok(COUNTING_AGGREGATES.includes('count') && COUNTING_AGGREGATES.includes('distinct'));
});

test('describeNumbers is the five-number summary plus the moments', () => {
  const d = describeNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null]);
  assert.equal(d.n, 10);
  assert.equal(d.sum, 55);
  assert.equal(d.avg, 5.5);
  assert.equal(d.median, 5.5);
  assert.equal(d.min, 1);
  assert.equal(d.max, 10);
  assert.equal(d.p25, 3.25);
  assert.equal(d.p75, 7.75);
  assert.equal(d.range, 9);
  assert.equal(d.stdev.toFixed(4), '3.0277');
  assert.deepEqual(describeNumbers([]), { n: 0, sum: 0, avg: null, median: null, min: null, max: null, p25: null, p75: null, range: null, stdev: null });
});

test('histogram bins a list into equal-width buckets and never loses a value to the top edge', () => {
  const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(h.length, 5);
  assert.equal(h.reduce((a, b) => a + b.count, 0), 11);
  assert.equal(h[0].from, 0);
  assert.equal(h[4].to, 10);
  assert.equal(h[4].count, 3); // 8, 9 and the 10 on the top edge
  assert.deepEqual(histogram([], 5), []);
  // One distinct value is one bucket, not a division by zero.
  assert.deepEqual(histogram([4, 4, 4], 5), [{ from: 4, to: 4, count: 3 }]);
});

test('distribution counts display values, flattens lists, and ranks by count then name', () => {
  const d = distribution([['a', 'b'], 'b', null, 'b', ['a'], '']);
  assert.deepEqual(d, [
    { value: 'b', count: 3 },
    { value: 'a', count: 2 },
    { value: null, count: 2 },
  ]);
});
