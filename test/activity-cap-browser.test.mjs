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
});
if (s) {
  const { base, browser } = s;
  const showing = (page, name) => page.waitForFunction(
    (title) => document.querySelector('#main')?.textContent.includes(title),
    `Activity — ${name}`, { timeout: 10000 });
  test('the entity Activity table note carries the count', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/activity/${busy.id}`, { waitUntil: 'load' });
      await showing(page, 'busy');
      const note = await page.textContent('.wv-note');
      assert.match(note, /7 older entries not kept/);
      await page.route(`**/api/activity?*entity=${quiet.id}*`, async (route) => {
        await new Promise((r) => setTimeout(r, 400));
        await route.continue();
      });
      await page.goto(`${base}/#/activity/${quiet.id}`, { waitUntil: 'load' });
      await showing(page, 'quiet');
      assert.doesNotMatch(await page.textContent('.wv-note'), /not kept/);
    } finally { await page.close(); }
  });
}
