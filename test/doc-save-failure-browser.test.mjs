import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let table;
const s = await launch('a failed document save keeps the draft', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
});

if (s) {
  const { browser, base, weave } = s;

  test('a rejected save keeps the text through navigation and saves it once the server accepts (Issue #1443)', async () => {
    const id = weave.createEntity(table, { name: 'Row' }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      let refused = 0;
      const refuse = (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        refused++;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk full' }) });
      };
      await page.route('**/doc', refuse);
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      const section = page.locator('.doc-section[data-doc-field="Description"]');
      const surface = section.locator('.vditor-ir [contenteditable="true"]');
      await surface.waitFor();
      await surface.click();
      await page.keyboard.type('KEEPMEDRAFT');
      await page.evaluate(() => window.__weaveFlushDocSaves());
      assert.ok(await eventually(() => refused > 0, true), 'the save reached the server and was refused');
      const kept = () => page.evaluate(() => [...window.__weaveDocSaves.values()].some((p) => String(p.value ?? '').includes('KEEPMEDRAFT')));
      assert.equal(await eventually(kept, true), true, 'the draft stays queued after the refusal');
      assert.equal(await eventually(() => section.locator('.doc-status').textContent(), '!'), '!', 'the section shows the save failed');

      await page.evaluate((t) => { location.hash = `#/table/${t}`; }, table.id);
      await page.locator('.doc-section').waitFor({ state: 'detached' });
      await page.evaluate((e) => { location.hash = `#/entity/${e}`; }, id);
      await surface.waitFor();
      assert.match(await surface.textContent(), /KEEPMEDRAFT/, 'the reopened editor shows the unsaved draft');

      await page.unroute('**/doc', refuse);
      await page.evaluate(() => window.__weaveFlushDocSaves());
      assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes('KEEPMEDRAFT'), true), true, 'the draft lands once the server accepts it');
      assert.equal(await eventually(kept, false), false, 'a saved draft leaves the queue');
    } finally {
      await page.close();
    }
  });
}
