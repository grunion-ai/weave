import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let root, child, empty, guest, own;
const s = await launch('space hierarchy start pages', (weave) => {
  weave.markOnboarded();
  root = weave.createSpace({ name: 'Product' });
  child = weave.createSpace({ name: 'Research', parentId: root.id });
  empty = weave.createSpace({ name: 'Empty' });
  weave.createSpace({ name: 'Operations' });
  own = weave.createTable({ space: 'Research', name: 'Notes' });
  guest = weave.createTable({ space: 'Operations', name: 'Tasks' });
  weave.updateSpace(root.id, { match: [['Name', '=', 'Tasks']] });
});

if (s) {
  const open = async (hash = '#/', theme = 'light', width = 1400) => {
    const page = await s.browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${s.base}/${hash}`);
    await page.waitForSelector('.home-contents');
    return page;
  };

  for (const theme of ['light', 'dark']) for (const width of [1400, 390]) {
    test(`${theme} ${width}: workspace lists top-level and empty spaces before optional overview`, async () => {
      const page = await open('#/', theme, width);
      assert.deepEqual(await page.locator('.home-contents a[data-space] .list-row-name').allTextContents(), ['Product', 'Empty', 'Operations']);
      assert.equal(await page.locator('.home-overview').evaluate((n) => n.open), false);
      assert.equal(await page.locator('.home-contents').evaluate((n) => n.getBoundingClientRect().bottom <= document.querySelector('.home-overview').getBoundingClientRect().top), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator(`.home-contents a[data-space="${empty.id}"]`).focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.space-tables');
      assert.match(await page.locator('.space-tables').textContent(), /No tables/);
      await page.close();
    });
  }

  test('space contents contain immediate subspaces and guest tables with a canonical home', async () => {
    const page = await open(`#/space/${root.id}`);
    assert.equal(await page.locator(`.home-contents a[data-space="${child.id}"]`).count(), 1);
    const row = page.locator(`.space-guests a[href="#/table/${guest.id}"]`);
    assert.match(await row.textContent(), /Operations/);
    await row.click();
    await page.waitForSelector('.wv-grid');
    assert.match(await page.locator('.crumb-path').textContent(), /Operations/);
    await page.close();
  });

  test('nested sidebar folds descendants and table breadcrumbs keep the full ancestor path', async () => {
    const page = await open(`#/space/${child.id}`);
    const parent = page.locator(`.nav-space-branch[data-space="${root.id}"]`);
    assert.equal(await parent.locator(`.nav-space-branch[data-space="${child.id}"]`).count(), 1);
    await parent.locator(':scope > .nav-space-row .nav-caret').click();
    assert.equal(await page.locator(`#nav a[href="#/space/${child.id}"]`).count(), 0);
    await page.locator(`#nav .nav-space-branch[data-space="${root.id}"] > .nav-space-row .nav-caret`).click();
    await page.locator(`.space-tables a[href="#/table/${own.id}"]`).click();
    await page.waitForSelector('.wv-grid');
    assert.match(await page.locator('.crumb-path').textContent(), /Product.*Research/);
    await page.close();
  });

  test('New subspace creates under the current space and Parent can move it to workspace level', async () => {
    const page = await open(`#/space/${child.id}`);
    await page.getByRole('button', { name: '+ New subspace', exact: true }).click();
    await page.locator('#tray input[name="name"]').fill('Interviews');
    await page.locator('#tray button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.view-header h1')?.textContent.includes('Interviews'));
    const made = s.weave.getSpace('Interviews');
    assert.equal(made.parentId, child.id);
    await page.getByRole('button', { name: 'Parent', exact: true }).click();
    await page.locator('#tray .picker-face').click();
    await page.locator('.picker-pop .picker-row').filter({ hasText: /^Workspace$/ }).click();
    await page.locator('#tray button[type="submit"]').click();
    await page.waitForSelector('#tray', { state: 'detached' });
    assert.equal(s.weave.getSpace('Interviews').parentId ?? null, null);
    await settled(page.locator('.home-contents'));
    await page.close();
  });
}
