import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const ids = {};
const s = await launch('workspace rail inset', (weave) => {
  const space = weave.createSpace({ name: 'Development' });
  ids.space = space.id;
  for (const [name, rows] of [['Feature', 2], ['Issue', 80], ['Release', 60]]) {
    const t = weave.createTable({ space: 'Development', name });
    ids[name] = t.id;
    for (let i = 0; i < rows; i++) weave.createEntity(t, { name: `${name} ${i + 1}` });
  }
}, { engine: 'webkit' });

if (s) {
  const { base, browser } = s;
  test('the rail and sidebar hold one left edge on every table and the space landing', async (t) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const seen = {};
    for (const [label, hash] of [
      ['Feature', `#/table/${ids.Feature}`],
      ['Issue', `#/table/${ids.Issue}`],
      ['Release', `#/table/${ids.Release}`],
      ['space', `#/space/${ids.space}`],
    ]) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      if (label !== 'space') {
        await page.waitForFunction((n) => document.querySelectorAll('.wv-grid tbody tr.entity-row').length >= n,
          label === 'Feature' ? 2 : 20);
      } else {
        await page.waitForFunction(() => !document.querySelector('.wv-grid'));
      }
      seen[label] = await page.evaluate(() => {
        const se = document.scrollingElement;
        return {
          rail: document.querySelector('#ws-rail').getBoundingClientRect().left,
          sidebar: document.querySelector('#sidebar').getBoundingClientRect().left,
          scrollLeft: se.scrollLeft,
          gutter: innerWidth - se.clientWidth,
        };
      });
    }
    await page.close();
    const all = JSON.stringify(seen);
    if (!seen.Issue.gutter) return t.skip(`overlay scrollbars here: no gutter to measure (${all})`);
    assert.equal(seen.Feature.gutter, 0, `the short Feature table must not scroll the page (${all})`);
    for (const [label, m] of Object.entries(seen)) {
      assert.equal(m.rail, 0, `${label}: rail left is ${m.rail}px (${all})`);
      assert.equal(m.sidebar, 52, `${label}: sidebar left is ${m.sidebar}px (${all})`);
      assert.equal(m.scrollLeft, 0, `${label}: page scrollLeft is ${m.scrollLeft} (${all})`);
    }
  });
}
