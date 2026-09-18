/* The activity cap made visible in a real browser (Issue #281). An entity past
   ACTIVITY_CAP entries says how many older ones it no longer holds: one line
   under its Activity pane, and one sentence in the entity's Activity table
   note. An entity that never hit the cap shows neither. Both themes.

   Playwright is imported dynamically by ./lib/browser.mjs; the suite skips on
   a bare checkout (house rule: zero runtime deps). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { ACTIVITY_CAP } from '../src/engine.js';

let busy, quiet;
const s = await launch('activity cap', (weave) => {
  weave.createSpace({ name: 'Ops' });
  const t = weave.createTable({ space: 'Ops', name: 'Ticket' });
  quiet = weave.createEntity(t, { name: 'quiet' });
  busy = weave.createEntity(t, { name: 'busy' });
  for (let i = 0; i < ACTIVITY_CAP + 6; i++) weave.addComment(busy.id, { text: `c${i}` });
  weave.updateTable(t, { systemFields: ['Activity'] });
});
if (s) {
  const { base, browser } = s;
  for (const colorScheme of ['light', 'dark']) {
    test(`entity pane names the dropped count (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/entity/${busy.id}`, { waitUntil: 'load' });
        const line = await page.waitForSelector('.activity-dropped');
        assert.equal((await line.textContent()).trim(), '7 older entries not kept');
        assert.ok(await line.isVisible());
        const { fg, bg } = await line.evaluate((n) => ({ fg: getComputedStyle(n).color, bg: getComputedStyle(document.body).backgroundColor }));
        assert.notEqual(fg, bg, 'legible against the page');

        await page.goto(`${base}/#/entity/${quiet.id}`, { waitUntil: 'load' });
        await page.waitForSelector('.activity-item');
        assert.equal(await page.$('.activity-dropped'), null, 'an entity under the cap shows no marker');
      } finally { await page.close(); }
    });
  }

  test('the entity Activity table note carries the count', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/activity/${busy.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.activity-row');
      const note = await page.textContent('.wv-note');
      assert.match(note, /7 older entries not kept/);
      await page.goto(`${base}/#/activity/${quiet.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.activity-row');
      assert.doesNotMatch(await page.textContent('.wv-note'), /not kept/);
    } finally { await page.close(); }
  });
}
