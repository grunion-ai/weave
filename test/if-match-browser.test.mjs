import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let deals, row;
const s = await launch('a stale cell commit is refused and repainted', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField(deals, { name: 'Stage', type: 'text' });
  row = weave.createEntity(deals, { name: 'Acme', values: { Stage: 'Lead' } });
});

if (s) {
  const { base, browser, weave } = s;
  const cell = () => `tr[data-eid="${row.id}"] td[data-field="Stage"] input`;
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(cell());
    return { context, page };
  };
  const patched = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
  const commit = async (page, text) => {
    const landed = patched(page);
    await page.fill(cell(), text);
    await page.keyboard.press('Tab');
    return landed;
  };
  const stage = () => weave.readEntity(row.id).fields.Stage;

  test('two people edit one cell: the second commit is refused, shows the first one\'s value and a toast that keeps theirs', async () => {
    weave.updateEntity(row.id, { Stage: 'Lead' });
    const alice = await open();
    const bob = await open();
    try {
      const first = await commit(alice.page, 'Won');
      assert.equal(first.status(), 200);
      assert.ok(first.request().headers()['if-match'], 'the commit names the revision it was drawn from');
      assert.equal(stage(), 'Won');

      const second = await commit(bob.page, 'Lost');
      assert.equal(second.status(), 412, 'the stale commit is refused');
      assert.equal(stage(), 'Won', 'and wrote nothing');
      await bob.page.waitForFunction((sel) => document.querySelector(sel)?.value === 'Won', cell());
      const note = bob.page.locator('#wv-toasts .wv-toast.err');
      await note.waitFor();
      await settled(note);
      const text = await note.locator('.wv-toast-msg').textContent();
      assert.match(text, /Stage/, `the toast names the field: ${text}`);
      assert.match(text, /Won/, `and the value that won: ${text}`);
      assert.match(text, /Lost/, `and keeps the typed one: ${text}`);

      const retried = patched(bob.page);
      await note.locator('.wv-toast-action', { hasText: 'Use mine' }).click();
      assert.equal((await retried).status(), 200, 'the kept value commits on purpose from the fresh revision');
      assert.equal(stage(), 'Lost');
      await bob.page.waitForFunction((sel) => document.querySelector(sel)?.value === 'Lost', cell());
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });

  test('a commit while offline is refused out loud and the typed text stays in the cell', async () => {
    weave.updateEntity(row.id, { Stage: 'Lead' });
    const { context, page } = await open();
    try {
      await context.setOffline(true);
      await page.fill(cell(), 'Typed offline');
      await page.keyboard.press('Tab');
      const note = page.locator('#wv-toasts .wv-toast.err');
      await note.waitFor();
      await settled(note);
      assert.match(await note.locator('.wv-toast-msg').textContent(), /Stage was not saved: could not reach the server/);
      assert.equal(await page.inputValue(cell()), 'Typed offline', 'the typed text is still there to retry');
      assert.equal(stage(), 'Lead', 'nothing reached the row');
      await context.setOffline(false);
    } finally { await context.close(); }
  });
}
