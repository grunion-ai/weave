/* The Activity table in a real browser reads newest first by commit order
   (Issue #282), not by the wall clock it displays. Six records created inside
   one instant used to be ranked by entity uuid, so the table could show the
   first one made at the top. Both themes. Playwright is imported dynamically
   by ./lib/browser.mjs; the suite skips on a bare checkout (house rule: zero
   runtime deps). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const AT = '2026-09-20T12:00:00.000Z';
let made = [];
const s = await launch('activity order', (weave) => {
  weave.createSpace({ name: 'Ops' });
  const t = weave.createTable({ space: 'Ops', name: 'Ticket' });
  made = Array.from({ length: 6 }, (_, i) => weave.createEntity(t, { name: `t${i}` }).id);
  // One instant for the whole workspace: the case with no wall-clock answer.
  for (const e of Object.values(weave.state.entities)) for (const a of e.activity ?? []) a.ts = AT;
});

if (s) {
  const { base, browser } = s;
  for (const colorScheme of ['light', 'dark']) {
    test(`the Activity table lists the last commit first (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity`, { waitUntil: 'load' });
        await page.waitForSelector('.activity-row');
        const hrefs = await page.$$eval('.activity-row', (ns) => ns.map((n) => n.dataset.href));
        assert.deepEqual(hrefs.slice(0, 6), [...made].reverse().map((id) => `#/activity/${id}:0`),
          'the six creations read newest first');
        const when = await page.$eval('.activity-when', (n) => ({ text: n.textContent.trim(), title: n.getAttribute('title'), fg: getComputedStyle(n).color, bg: getComputedStyle(document.body).backgroundColor }));
        assert.equal(when.title, AT, 'the column still displays the wall clock');
        assert.ok(when.text.length, 'localised in the cell, ISO on hover');
        assert.notEqual(when.fg, when.bg, 'legible against the page');
      } finally { await page.close(); }
    });
  }
}
