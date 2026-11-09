import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phonePage } from './lib/browser.mjs';

const s = await launch('structure trash', (weave) => {
  weave.markOnboarded();
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser, weave } = s;
  const MENU = '.chip-pop.wv-menu[role="menu"]';
  let n = 0;
  const uniq = (stem) => `${stem}${++n}`;

  async function open(hash, theme = 'light', page = null) {
    page ??= await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/${hash}`);
    return page;
  }
  const trashRow = (page, name) => page.locator('#main tr', { has: page.locator('td', { hasText: new RegExp(`^${name}$`) }) });
  const navHas = (page, selector, name) => page.waitForFunction(([sel, nm]) => [...document.querySelectorAll(sel)].some((a) => a.textContent.trim() === nm), [selector, name]);
  const readable = (locator) => locator.evaluate((b) => {
    const bg = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
    return getComputedStyle(b).color !== bg(b);
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: a trashed table lists in Trash as a table with its space and deletion time, and one click restores it (Feature #160)`, async () => {
      const name = uniq('Gone');
      const db = weave.createTable({ space: 'Product', name });
      weave.deleteTable(db.id);
      const page = await open('#/trash', theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        const row = trashRow(page, name);
        await row.waitFor();
        assert.equal((await row.locator('.trash-table').textContent()).trim(), 'Table in Product');
        assert.match(await row.locator('.trash-when').textContent(), /\S/, 'the row shows when it was deleted');
        const restore = row.locator('button', { hasText: 'Restore' });
        assert.ok(await readable(restore), 'Restore reads against its row');
        await restore.click();
        assert.equal(await eventually(() => weave.state.tables[db.id]?.deletedAt ?? null, null), null, 'the table is live again');
        await navHas(page, '#nav a.nav-db', name);
        await row.waitFor({ state: 'detached' });
      } finally { await page.close(); }
    });

    test(`${theme}: a trashed space lists in Trash as a space, and one click restores it with its tables (Feature #160)`, async () => {
      const name = uniq('Old');
      const sp = weave.createSpace({ name });
      weave.createTable({ space: name, name: 'Thing' });
      weave.deleteSpace(sp.id);
      const page = await open('#/trash', theme);
      try {
        const row = trashRow(page, name);
        await row.waitFor();
        assert.equal((await row.locator('.trash-table').textContent()).trim(), 'Space');
        await row.locator('button', { hasText: 'Restore' }).click();
        assert.equal(await eventually(() => weave.state.spaces[sp.id]?.deletedAt ?? null, null), null, 'the space is live again');
        await navHas(page, '#nav a.nav-space', name);
        await row.waitFor({ state: 'detached' });
      } finally { await page.close(); }
    });
  }

  test('a table inside a trashed space says to restore the space first (Feature #160)', async () => {
    const name = uniq('Inner');
    const spName = uniq('Shell');
    const sp = weave.createSpace({ name: spName });
    const db = weave.createTable({ space: spName, name });
    weave.deleteTable(db.id);
    weave.deleteSpace(sp.id);
    const page = await open('#/trash');
    try {
      await trashRow(page, name).locator('button', { hasText: 'Restore' }).click();
      await page.locator('.wv-toast', { hasText: `restore the space first` }).waitFor();
      assert.ok(weave.state.tables[db.id].deletedAt, 'the table stays in the trash');
    } finally { await page.close(); }
  });

  test('a record and a table list side by side, each named by what it is (Feature #160)', async () => {
    const task = weave.getTable('Task');
    const name = uniq('Note');
    const rec = weave.createEntity(task, { name });
    weave.deleteEntity(rec.id);
    const page = await open('#/trash');
    try {
      const row = trashRow(page, name);
      await row.waitFor();
      assert.equal((await row.locator('.trash-table').textContent()).trim(), 'Record in Product/Task');
      assert.deepEqual((await page.locator('#main thead th').allTextContents()).map((t) => t.trim()), ['#', 'Name', 'Type', 'Deleted', '']);
    } finally { await page.close(); }
  });

  for (const [what, hash, trigger] of [
    ['the table header menu', () => `#/table/${weave.getTable('Task').id}`, '#main .crumb-row .dots-btn[title="Table actions"]'],
    ['the space header menu', () => `#/space/${weave.getSpace('Product').id}`, '#main .view-header .crumb-row .dots-btn'],
    ['the sidebar space menu', () => '#/', () => `#nav .nav-space-row:has(a.nav-space[href="#/space/${weave.getSpace('Product').id}"]) .nav-space-menu .dots-btn`],
  ]) {
    test(`${what} opens Trash (Feature #160)`, async () => {
      const page = await open(hash());
      try {
        const sel = typeof trigger === 'function' ? trigger() : trigger;
        await page.waitForSelector(sel, { state: 'attached' });
        await page.locator(sel).first().click({ force: true });
        await page.waitForSelector(MENU);
        await page.locator(`${MENU} .wv-menu-row`, { hasText: 'Open trash' }).click();
        await page.waitForFunction(() => location.hash === '#/trash' && document.querySelector('#main .view-header')?.textContent.includes('Trash'));
      } finally { await page.close(); }
    });
  }

  test('the sidebar Trash row opens Trash (Feature #160)', async () => {
    const page = await open('#/');
    try {
      await page.click('#sidebar .nav-system a[href="#/trash"]');
      await page.waitForFunction(() => location.hash === '#/trash' && document.querySelector('#main .view-header')?.textContent.includes('Trash'));
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: at phone width Trash fits the screen and restores a table (Feature #160)`, async () => {
      const name = uniq('Pocket');
      const db = weave.createTable({ space: 'Product', name });
      weave.deleteTable(db.id);
      const page = await open('#/trash', theme, await phonePage(browser));
      try {
        const row = trashRow(page, name);
        await row.waitFor();
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), true, 'the page never scrolls sideways');
        const restore = row.locator('button', { hasText: 'Restore' });
        await restore.scrollIntoViewIfNeeded();
        const box = await restore.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'Restore sits on screen');
        assert.ok(await readable(restore), 'Restore reads against its row');
        await restore.click();
        assert.equal(await eventually(() => weave.state.tables[db.id]?.deletedAt ?? null, null), null);
      } finally { await page.close(); }
    });
  }
}
