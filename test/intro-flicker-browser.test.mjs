import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { introPage } from './lib/states.mjs';

let intro;
const s = await launch('introduction flicker', (w) => {
  w.createSpace({ name: 'Work' });
  intro = introPage(w);
});

const FIELDS = '#dock .entity-body > .entity-fields';
const watch = (page, id) => page.evaluate(([fields, id]) => {
  const seen = { tops: [], frames: 0 };
  const built = new WeakSet();
  new MutationObserver(() => {
    for (const f of document.querySelectorAll('#dock iframe.fits-content')) {
      if (!built.has(f)) { built.add(f); seen.frames++; }
    }
  }).observe(document.querySelector('#dock'), { childList: true, subtree: true });
  const tick = () => {
    const node = document.querySelector('#dock').dataset.eid === id ? document.querySelector(fields) : null;
    if (node && getComputedStyle(node).visibility === 'visible') {
      const top = Math.round(node.getBoundingClientRect().top - document.querySelector('#dock').getBoundingClientRect().top + document.querySelector('#dock').scrollTop);
      if (seen.tops.at(-1) !== top) seen.tops.push(top);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__intro = seen;
}, [FIELDS, id]);

async function open(page, id) {
  await page.click(`tr[data-eid="${id}"] .open-link`);
  await page.waitForSelector(`#dock[data-eid="${id}"] .fieldrow[data-field="Owner"]`);
}

if (s) {
  const { base, browser } = s;
  test('the dock builds the introduction once and its Fields section never moves after the introduction loads (Issue #1552)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${intro.table}?e=${intro.other}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Owner"]');
      for (const pass of ['first open', 'reopen']) {
        await watch(page, intro.row);
        await open(page, intro.row);
        await page.frameLocator('#dock .attachment-intro iframe').locator('p').last().waitFor();
        await page.waitForTimeout(400);
        const seen = await page.evaluate(() => window.__intro);
        assert.equal(seen.frames, 1, `${pass}: the introduction frame was built ${seen.frames} times`);
        assert.equal(seen.tops.length, 1, `${pass}: the Fields section showed at ${seen.tops.join(' then ')} px`);
        const frame = await page.locator('#dock .attachment-intro iframe').boundingBox();
        assert.ok(seen.tops[0] > frame.height, `${pass}: the Fields section sits below the ${Math.round(frame.height)} px introduction`);
        await open(page, intro.other);
      }
    } finally {
      await page.close();
    }
  });
}
