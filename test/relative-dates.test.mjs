import test from 'node:test';
import assert from 'node:assert/strict';
import { APP } from './lib/source.mjs';

await import('../public/date-core.js');
const { relativeOrShort } = globalThis.weaveDateCore;

const now = new Date(2026, 9, 10, 15, 30, 0);
const at = (...parts) => new Date(...parts).toISOString();

test('recent times read relatively, older ones as a short date', () => {
  assert.equal(relativeOrShort(at(2026, 9, 10, 15, 29, 40), now).text, 'just now');
  assert.equal(relativeOrShort(at(2026, 9, 10, 15, 30, 20), now).text, 'just now', 'a little clock skew is still now');
  assert.equal(relativeOrShort(at(2026, 9, 10, 15, 28, 0), now).text, '2 min ago');
  assert.equal(relativeOrShort(at(2026, 9, 10, 14, 31, 0), now).text, '59 min ago');
  assert.match(relativeOrShort(at(2026, 9, 10, 9, 5, 0), now).text, /^Today 9:05/);
  assert.equal(relativeOrShort(at(2026, 9, 9, 23, 59, 0), now).text, 'Yesterday');
  assert.equal(relativeOrShort(at(2026, 8, 16, 1, 6, 37), now).text, 'Sep 16');
  assert.equal(relativeOrShort(at(2025, 8, 16, 1, 6, 37), now).text, 'Sep 16, 2025');
  assert.equal(relativeOrShort(at(2026, 11, 1, 9, 0, 0), now).text, 'Dec 1', 'a future date in the year is a short date');
});

test('the full timestamp, with seconds, rides along for the title', () => {
  const { text, title } = relativeOrShort(at(2026, 8, 16, 1, 6, 37), now);
  assert.equal(text, 'Sep 16');
  assert.match(title, /2026/);
  assert.match(title, /1:06:37/);
});

test('a missing or unreadable timestamp prints nothing', () => {
  for (const bad of [null, undefined, '', 'not a date']) assert.deepEqual(relativeOrShort(bad, now), { text: '', title: '' });
});

test('app.js prints no raw toLocaleString date', () => {
  assert.doesNotMatch(APP, /new Date\([^)]*\)\.toLocaleString\(/, 'dates go through dateCore.relativeOrShort');
  assert.doesNotMatch(APP, /function relTime\(/, 'the unused relTime helper is gone');
});
