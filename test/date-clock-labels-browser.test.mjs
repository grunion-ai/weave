import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
let meetings;
const s = await launch('date clock labels', (weave) => {
  weave.createSpace({ name: 'Ops' });
  meetings = weave.createTable({ space: 'Ops', name: 'Meeting' });
  weave.addField(meetings, { name: 'Starts', type: 'date', config: { format: 'long', time: true } });
});
if (s) {
  const { base, browser, weave } = s;
  const clockLabels = (page) => page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Clock$/ }) }).locator('.seg-opt').allTextContents();
  const openTray = async () => {
    const id = weave.createEntity(meetings, { name: 'Standup' }).id;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.locator('.entity-fields .fieldrow', { hasText: 'Starts' }).first().locator('.fieldrow-label').click();
    await page.waitForSelector('#tray');
    return page;
  };

  test('under the long format the Clock options read as the clock alone', async () => {
    const page = await openTray();
    try {
      assert.deepEqual(await clockLabels(page), ['14:30', '2:30 PM']);
    } finally { await page.close(); }
  });

  test('every date format leaves the Clock options as the clock alone', async () => {
    const page = await openTray();
    try {
      const formats = await page.locator('#tray .date-format-opt .date-format-id').allTextContents();
      assert.ok(formats.length > 1, 'the tray offers several formats');
      for (const fmt of formats) {
        await page.locator('#tray .date-format-opt', { has: page.locator('.date-format-id', { hasText: new RegExp(`^${fmt}$`) }) }).click();
        assert.deepEqual(await clockLabels(page), ['14:30', '2:30 PM'], `format ${fmt}`);
      }
    } finally { await page.close(); }
  });
}
