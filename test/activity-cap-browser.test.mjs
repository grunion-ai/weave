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
