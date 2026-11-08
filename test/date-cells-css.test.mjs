import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS, rulesFor } from './lib/source.mjs';

test('the day cell and the month or year cell share one base rule and differ only in height (Feature #177)', () => {
  const day = rulesFor('.date-day');
  const pick = rulesFor('.date-pick-cell');
  assert.equal(day.height, '28px');
  assert.equal(pick.height, '34px');
  for (const prop of ['border', 'border-radius', 'background', 'color', 'font-size', 'cursor']) assert.equal(day[prop], pick[prop], prop);
  assert.match(CSS, /\.date-day, \.date-pick-cell \{/, 'one shared base rule');
  assert.match(CSS, /\.date-day:hover, \.date-pick-cell:hover \{/, 'one shared hover');
  assert.match(CSS, /\.date-day\.sel, \.date-pick-cell\.sel \{/, 'one shared selected state');
});
