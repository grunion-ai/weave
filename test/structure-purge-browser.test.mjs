import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phonePage } from './lib/browser.mjs';
import { hold } from './lib/hold.mjs';

const s = await launch('structure purge', (weave) => {
  weave.markOnboarded();
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser, weave } = s;
  let n = 0;
  const uniq = (stem) => `${stem}${++n}`;

  async function open(theme = 'light', page = null) {
    page ??= await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('#main .settings-purge');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  }
  const purgeRow = (page, name) => page.locator('#main .settings-purge tr.purge-row', { has: page.locator('td', { hasText: new RegExp(`^${name}$`) }) });
  const colorsDiffer = (locator) => locator.evaluate((b) => {
    const bg = (e) => { for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
    return getComputedStyle(b).color !== bg(b);
  });
  async function purge(page, name) {
    const row = purgeRow(page, name);
    await row.locator('.purge-open').click();
    const confirm = page.locator('#main .settings-purge .purge-confirm');
    const go = confirm.locator('.hold-btn');
    await go.waitFor();
    assert.ok(await go.isDisabled(), 'the hold is off until the name is typed');
    await confirm.locator('input').fill(name);
    assert.ok(await go.isEnabled(), 'the exact name arms it');
    await hold(go);
    await row.waitFor({ state: 'detached' });
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: Settings names a trashed table and purges it for good behind its typed name and a hold (Feature #160, Feature #295)`, async () => {
      const name = uniq('Doomed');
      const db = weave.createTable({ space: 'Product', name });
      weave.createEntity(db, { name: 'Inside' });
      weave.deleteTable(db.id);
      const page = await open(theme);
      try {
        const row = purgeRow(page, name);
        await row.waitFor();
        assert.equal((await row.locator('.trash-table').textContent()).trim(), 'Table in Product');
        assert.ok(await colorsDiffer(row.locator('.purge-open')), 'Delete forever reads against its row');
        await purge(page, name);
        assert.equal(await eventually(() => !!weave.state.tables[db.id], false), false, 'the table is gone for good');
      } finally { await page.close(); }
    });

    test(`${theme}: Settings names a trashed space and purges it with its tables (Feature #160, Feature #295)`, async () => {
      const name = uniq('Attic');
      const sp = weave.createSpace({ name });
      const inner = weave.createTable({ space: name, name: 'Box' });
      weave.deleteSpace(sp.id);
      const page = await open(theme);
      try {
        const row = purgeRow(page, name);
        await row.waitFor();
        assert.equal((await row.locator('.trash-table').textContent()).trim(), 'Space');
        await purge(page, name);
        assert.equal(await eventually(() => !!weave.state.spaces[sp.id], false), false, 'the space is gone for good');
        assert.equal(weave.state.tables[inner.id], undefined, 'and its tables with it');
      } finally { await page.close(); }
    });
  }

  test('the Settings purge header names the column Type (Feature #160)', async () => {
    const name = uniq('Header');
    const db = weave.createTable({ space: 'Product', name });
    weave.deleteTable(db.id);
    const page = await open();
    try {
      await purgeRow(page, name).waitFor();
      assert.deepEqual((await page.locator('#main .settings-purge thead th').allTextContents()).map((t) => t.trim()), ['Name', 'Type', 'Deleted', '']);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: at phone width Settings fits the screen and purges a table (Feature #160)`, async () => {
      const name = uniq('Pocket');
      const db = weave.createTable({ space: 'Product', name });
      weave.deleteTable(db.id);
      const page = await open(theme, await phonePage(browser));
      try {
        await purgeRow(page, name).waitFor();
        assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), true, 'the page never scrolls sideways');
        const btn = purgeRow(page, name).locator('.purge-open');
        await btn.scrollIntoViewIfNeeded();
        const box = await btn.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width, 'Delete forever sits on screen');
        assert.ok(await colorsDiffer(btn), 'Delete forever reads against its row');
        await purge(page, name);
        assert.equal(await eventually(() => !!weave.state.tables[db.id], false), false);
      } finally { await page.close(); }
    });
  }
}
