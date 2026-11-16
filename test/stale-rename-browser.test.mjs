import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let deals, row;
const s = await launch('a stale rename is refused, repainted and offered back', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  row = weave.createEntity(deals, { name: 'Acme' });
});

if (s) {
  const { base, browser, weave } = s;
  const NAME = '#main textarea.name-edit';
  const patched = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
  const name = () => weave.readEntity(row.id).name;

  test('renaming a record another person just renamed shows theirs in the header and a toast that offers mine back', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(NAME);
      await page.click(NAME);
      await page.fill(NAME, 'Acme Mine');
      weave.updateEntity(row.id, { Name: 'Acme Theirs' });
      const refused = patched(page);
      await page.keyboard.press('Enter');
      assert.equal((await refused).status(), 412, 'the rename names the revision it was drawn from and is refused');
      assert.equal(name(), 'Acme Theirs', 'and wrote nothing');
      const note = page.locator('#wv-toasts .wv-toast.err');
      await note.waitFor();
      await settled(note);
      const text = await note.locator('.wv-toast-msg').textContent();
      assert.match(text, /Name/, `the toast names the field: ${text}`);
      assert.match(text, /Acme Theirs/, `and the name that won: ${text}`);
      assert.match(text, /Acme Mine/, `and keeps the typed one: ${text}`);
      assert.equal(await page.inputValue(NAME), 'Acme Theirs', 'the header shows the name that won');
      const retried = patched(page);
      await note.locator('.wv-toast-action', { hasText: 'Use mine' }).click();
      assert.equal((await retried).status(), 200, 'mine commits on purpose from the fresh revision');
      assert.equal(name(), 'Acme Mine');
      await page.waitForFunction((sel) => document.querySelector(sel)?.value === 'Acme Mine', NAME);
    } finally { await context.close(); }
  });

  test('a rename while offline says so and keeps the typed name in the header', async () => {
    weave.updateEntity(row.id, { Name: 'Acme' });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(NAME);
      await context.setOffline(true);
      await page.click(NAME);
      await page.fill(NAME, 'Typed offline');
      await page.keyboard.press('Enter');
      const note = page.locator('#wv-toasts .wv-toast.err');
      await note.waitFor();
      assert.match(await note.locator('.wv-toast-msg').textContent(), /Name was not saved: could not reach the server/);
      assert.equal(await page.inputValue(NAME), 'Typed offline', 'the typed name is still there to retry');
      assert.equal(name(), 'Acme', 'nothing reached the row');
      await context.setOffline(false);
    } finally { await context.close(); }
  });
}
