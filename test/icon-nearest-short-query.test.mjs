import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestIcons } from '../src/vocabulary.js';

test('a one or two letter query suggests no icon by substring alone', () => {
  assert.deepEqual(nearestIcons('a'), []);
  assert.deepEqual(nearestIcons('ar', 10), []);
  assert.deepEqual(nearestIcons('at', 10), []);
});

test('a query of three letters or more still matches by substring', () => {
  const names = nearestIcons('arrow-up', 10).map((e) => e.name);
  assert.ok(names.includes('arrow-up'));
});
