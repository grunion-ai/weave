import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname);
const WINDOW = 6;
const RULE = 'A browser case that waits for a selector and then reads it back through $eval or $$eval resolves that selector twice. The node the wait found is gone if the view repaints in between, and a loaded gate opens that gap wide enough to lose (Issue #637). Read through page.locator(sel).first().evaluate(fn) or page.locator(sel).evaluateAll(fn), which re-resolves on each attempt.';

const WAIT = /waitForSelector\(\s*(['"`])(.+?)\1/;
const READ = /\$\$?eval\(\s*(['"`])(.+?)\1/;
const DEMONSTRATES = /assert\.rejects/;

export function twoStepReads(src) {
  const lines = src.split('\n');
  const at = [];
  for (let i = 0; i < lines.length; i++) {
    const wait = lines[i].match(WAIT);
    if (!wait) continue;
    for (let j = i + 1; j < Math.min(i + WINDOW, lines.length); j++) {
      const read = lines[j].match(READ);
      if (!read || read[2] !== wait[2] || DEMONSTRATES.test(lines[j])) continue;
      at.push({ wait: i + 1, read: j + 1, selector: wait[2] });
    }
  }
  return at;
}

test('the scanner pairs a wait with a later read of the same selector', () => {
  assert.deepEqual(twoStepReads("await page.waitForSelector('#a');\nawait page.$eval('#a', (n) => n.id);"),
    [{ wait: 1, read: 2, selector: '#a' }]);
  assert.deepEqual(twoStepReads("await page.waitForSelector('#a');\nawait page.$eval('#b', (n) => n.id);"), [],
    'a read of a different selector is a different assertion, not this shape');
  assert.deepEqual(twoStepReads("await page.waitForSelector('#a');\nawait page.locator('#a').first().evaluate((n) => n.id);"), [],
    'a locator read re-resolves, so it is the fix');
  assert.deepEqual(twoStepReads(`await page.waitForSelector('#a');\n${'x;\n'.repeat(8)}await page.$eval('#a', (n) => n.id);`), [],
    'an unrelated read far below is not the pair');
  assert.deepEqual(twoStepReads("await page.waitForSelector('#a');\nawait assert.rejects(() => page.$eval('#a', (n) => n.id));"), [],
    'a read the case asserts throws is the demonstration of the shape, not a site of it');
});

test('no browser case reads back a selector it just waited for', () => {
  const hits = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('-browser.test.mjs')).sort()) {
    for (const h of twoStepReads(readFileSync(join(DIR, file), 'utf8'))) {
      hits.push(`test/${file}:${h.read} reads ${h.selector} waited for on line ${h.wait}`);
    }
  }
  assert.deepEqual(hits, [], `${RULE}\n${hits.length} site(s):\n${hits.join('\n')}`);
});
