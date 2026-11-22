import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST = import.meta.dirname;
const CLICK = /click\('#ws-new'|locator\('#ws-new'\)\.click\(/g;
const NAVIGATION = /\.goto\(|\.reload\(|waitForURL\(|go\(p, 'open'\)/g;
const READY = /waitForSelector\('#ws-new (?:> \.wv-icon|svg)'/;

function unreadyClicks(src) {
  const misses = [];
  for (const m of src.matchAll(CLICK)) {
    const before = src.slice(0, m.index);
    const since = [...before.matchAll(NAVIGATION)].at(-1)?.index ?? 0;
    if (!READY.test(before.slice(since))) misses.push(before.split('\n').length);
  }
  return misses;
}

test('the guard flags a #ws-new click that follows a navigation with no ready wait', () => {
  assert.deepEqual(unreadyClicks("await page.goto(u);\nawait page.waitForSelector('#ws-new svg');\nawait page.click('#ws-new');"), []);
  assert.deepEqual(unreadyClicks("await page.waitForSelector('#ws-new svg');\nawait page.goto(u);\nawait page.locator('#ws-new').click();"), [3]);
  assert.deepEqual(unreadyClicks("await go(p, 'open');\nawait p.waitForSelector('#ws-new', { state: 'attached' });\nawait p.locator('#ws-new').click();"), [3]);
});

test('every browser test clicks #ws-new only after the rail paints its icon, the signal wireWsNew gives before it binds the click (Issue #1482)', () => {
  const misses = readdirSync(TEST).filter((f) => f.endsWith('-browser.test.mjs'))
    .flatMap((f) => unreadyClicks(readFileSync(join(TEST, f), 'utf8')).map((line) => `${f}:${line}`));
  assert.deepEqual(misses, []);
});
