import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { hold } from './lib/hold.mjs';

let bugs;
const s = await launch('trash optimistic', (weave) => {
  weave.createSpace({ name: 'Dev' });
  bugs = weave.createTable({ space: 'Dev', name: 'Bug' });
});
if (s) {
  const { base, browser, weave } = s;
  const ROW = '.wv-grid tbody tr.entity-row';
  let n = 0;
  const fill = () => ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((name) => weave.createEntity(bugs, { name: `${name} ${++n}` }).id);

  async function grid(theme, { query = '', width = 1100 } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${bugs.id}${query}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ROW);
    return page;
  }
  const rowIds = (page) => page.locator(ROW).evaluateAll((rs) => rs.map((r) => r.dataset.eid));
  const live = (id) => !weave.state.entities[id].deletedAt;
  const waitRows = (page, k) => page.waitForFunction(
    ([sel, want]) => document.querySelectorAll(sel).length === want, [ROW, k], { timeout: 8000 });
  const holdDeletes = (page, { ms = 1000, refuse = false } = {}) => {
    const seen = { sent: 0, answered: 0 };
    return page.route(/\/api\/entities\/[^/?]+$/, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      seen.sent += 1;
      await new Promise((r) => setTimeout(r, ms));
      seen.answered += 1;
      if (refuse) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The trash is closed' }) });
      return route.continue();
    }).then(() => seen);
  };
  const pressTrash = async (page, ids) => {
    for (const id of ids.slice(1, 3)) await page.locator(`${ROW}[data-eid="${id}"] .sel-box`).check();
    await hold(page.locator('.sel-puck .sel-act.danger'));
  };
  const trashToast = (page) => page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the rows, the bar and the count leave before the delete answers, and the Undo toast is up at once (Issue #1058)`, async () => {
      const ids = fill();
      const page = await grid(theme);
      try {
        const before = await rowIds(page);
        const seen = await holdDeletes(page);
        await pressTrash(page, ids);
        await waitRows(page, before.length - 2);
        assert.equal(seen.answered, 0, 'the rows left while the delete was still in flight');
        assert.equal(await page.locator('.sel-puck').count(), 0, 'the selection bar went with the rows');
        assert.deepEqual(await rowIds(page), before.filter((id) => !ids.slice(1, 3).includes(id)), 'the two chosen rows are the ones gone');
        const toast = trashToast(page);
        await toast.waitFor();
        assert.ok(await toast.locator('.wv-toast-action', { hasText: 'Undo' }).isVisible(), `Undo shows in ${theme}`);
        assert.ok(ids.slice(1, 3).every(live), 'the server has not seen the delete yet');
        assert.ok(await eventually(() => ids.slice(1, 3).every((id) => !live(id)), true), 'then the delete lands');
        assert.equal(await page.locator(ROW).count(), before.length - 2, 'and the grid holds the same rows after the server answers');
      } finally { await page.close(); }
    });
  }

  test('a refused delete puts the rows back with an error toast and no Undo (Issue #1058)', async () => {
    const ids = fill();
    const page = await grid('light');
    try {
      const before = await rowIds(page);
      const seen = await holdDeletes(page, { ms: 300, refuse: true });
      await pressTrash(page, ids);
      await waitRows(page, before.length - 2);
      assert.equal(seen.answered, 0, 'the rows left first');
      await waitRows(page, before.length);
      assert.deepEqual((await rowIds(page)).sort(), [...before].sort(), 'every row is back');
      const err = page.locator('.wv-toast.err', { hasText: /Moved to trash: 2 of 2 failed/ });
      await err.waitFor();
      await page.locator('.wv-toast:not(.err)', { hasText: 'Moved to trash' }).waitFor({ state: 'detached' });
      assert.equal(await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).count(), 0, 'no Undo is offered for rows that never left');
      assert.ok(ids.every(live), 'nothing reached the trash');
    } finally { await page.close(); }
  });

  test('Undo pressed before the delete answers still brings every row back (Issue #1058)', async () => {
    const ids = fill();
    const page = await grid('light');
    try {
      const before = await rowIds(page);
      const seen = await holdDeletes(page, { ms: 800 });
      await pressTrash(page, ids);
      const toast = trashToast(page);
      await toast.waitFor();
      assert.equal(seen.answered, 0, 'Undo is pressed while the delete is in flight');
      await toast.locator('.wv-toast-action').click();
      await waitRows(page, before.length);
      assert.equal(seen.answered, 2, 'the delete landed before the undo ran');
      assert.ok(ids.every(live), 'both rows are out of the trash');
      assert.deepEqual((await rowIds(page)).sort(), [...before].sort(), 'the grid redrew with the rows back');
      await page.locator('.wv-toast', { hasText: 'Restored' }).last().waitFor();
    } finally { await page.close(); }
  });

  test('Undo pressed before the delete answers goes from the delete straight to the undo, with no grid reload between (Issue #1058)', async () => {
    const ids = fill();
    const page = await grid('light');
    try {
      const sent = [];
      page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === 'DELETE' || /\/api\/undo$|\/query$/.test(path)) sent.push(`${r.method()} ${path.replace(/\/[0-9a-f-]{36}/g, '/:id')}`);
      });
      await holdDeletes(page, { ms: 800 });
      await pressTrash(page, ids);
      const toast = trashToast(page);
      await toast.waitFor();
      await toast.locator('.wv-toast-action').click();
      await page.locator('.wv-toast', { hasText: 'Restored' }).last().waitFor();
      const after = sent.slice(sent.lastIndexOf('DELETE /api/entities/:id') + 1);
      assert.deepEqual(after.slice(0, 2), ['GET /api/undo', 'POST /api/undo'], `the undo follows the delete at once: ${sent.join(', ')}`);
      assert.ok(ids.every(live), 'both rows are out of the trash');
    } finally { await page.close(); }
  });

  test('trashing the docked row closes its dock in the same frame (Issue #1058)', async () => {
    const ids = fill();
    const page = await grid('light', { query: `?e=${ids[1]}`, width: 1280 });
    try {
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await holdDeletes(page);
      await pressTrash(page, ids);
      await page.waitForFunction(() => document.querySelector('#dock').hidden, null, { timeout: 2000 });
      assert.ok(!(await page.evaluate(() => location.hash)).includes(`e=${ids[1]}`), 'the address no longer names the trashed row');
      assert.ok(await eventually(() => !live(ids[1]), true), 'the delete lands after');
    } finally { await page.close(); }
  });
}
