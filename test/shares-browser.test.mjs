import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually, hold } from './lib/browser.mjs';

let task;
let one;
let space;
let view;
const s = await launch('share dialog', (weave) => {
  space = weave.createSpace({ name: 'Dev' });
  task = weave.createTable({ space: 'Dev', name: 'Task' });
  one = weave.createEntity(task.id, { name: 'One' });
  weave.createEntity(task.id, { name: 'Two' });
  view = weave.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };
  const fromMenu = async (page, scope) => {
    await page.locator(`${scope} .dots-btn`).first().click();
    await page.locator('.wv-menu .wv-menu-row', { hasText: 'Share…' }).click();
  };
  const dialog = (page) => page.locator('#modal');
  const reset = () => { for (const g of weave.listShares()) weave.revokeShare(g.id); };

  test('the entity page opens the share dialog: the mode ladder with comment held back, a private toggle, then mint and revoke', async () => {
    reset();
    const page = await open(`#/entity/${one.id}`);
    try {
      await painted(page, '.entity-head');
      await fromMenu(page, '.view-header .crumb-row');
      await painted(page, '#modal');
      assert.match(await dialog(page).locator('h2').textContent(), /Share/);
      const options = await page.$$eval('#modal input[name=mode]', (os) => os.map((o) => [o.value, o.disabled, o.checked]));
      assert.deepEqual(options, [['read', false, true], ['comment', true, false], ['edit', false, false], ['manage', false, false]]);
      assert.equal(await page.locator('#modal input[name=private]').count(), 1);
      await page.locator('#modal .share-hint', { hasText: 'No links yet' }).waitFor();
      await page.check('#modal input[name=mode][value=edit]');
      await page.fill('#modal input[name=label]', 'vendor');
      await page.locator('#modal button[type=submit]').click();
      assert.equal(await eventually(() => weave.listShares().length, 1), 1);
      const [g] = weave.listShares();
      assert.deepEqual([g.scope.kind, g.scope.id, g.mode, g.visibility, g.label], ['entity', one.id, 'edit', 'public', 'vendor']);
      await page.locator('#modal .share-row .share-url', { hasText: `/s/${g.token}` }).waitFor();
      await page.locator('#modal .share-row .share-revoke').click();
      assert.equal(weave.listShares().length, 1, 'a click alone revokes nothing');
      await hold(page.locator('#modal .share-row .share-revoke'));
      assert.equal(await eventually(() => weave.listShares().length, 0), 0);
      await page.locator('#modal .share-hint', { hasText: 'No links yet' }).waitFor();
    } finally {
      await page.close();
    }
  });

  test('the table menu and saved-view pages retain their legacy dialog on their own scope', async () => {
    reset();
    const cases = [
      [`#/table/${task.id}`, async (page) => fromMenu(page, '.view-header .crumb-row'), 'table', task.id],
      [`#/view/${view.id}`, async (page) => page.locator('#main .share-btn').click(), 'view', view.id],
    ];
    for (const [hash, opener, kind, id] of cases) {
      const page = await open(hash);
      try {
        await painted(page, '#main .view-header, #main h1');
        await opener(page);
        await painted(page, '#modal');
        await page.locator('#modal input[name=private]').check();
        await page.locator('#modal button[type=submit]').click();
        assert.equal(await eventually(() => weave.listShares({ kind, id }).length, 1), 1);
        assert.equal(weave.listShares({ kind, id })[0].visibility, 'private', `${kind}: the toggle reaches the grant`);
        await page.locator('#modal .share-row').first().waitFor();
      } finally {
        await page.close();
      }
    }
  });

  test('the space toolbar opens the beta panel and creates a link for the entire space', async () => {
    reset();
    const page = await open(`#/space/${space.id}`);
    try {
      await page.getByRole('button', { name: 'Share (Beta)', exact: true }).click();
      await page.locator('#share-pane:not([hidden])').waitFor();
      assert.match(await page.locator('#share-pane').innerText(), /Entire space: Dev/);
      assert.equal(await page.locator('#modal').count(), 0);
      await page.getByRole('button', { name: 'Add link', exact: true }).click();
      assert.equal(await page.getByLabel('Link purpose', { exact: true }).locator('option').count(), 1);
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      await page.locator('#share-pane .share-link').first().waitFor();
      const grants = weave.listShares({ kind: 'space', id: space.id });
      assert.equal(grants.length, 1);
      assert.equal(grants[0].mode, 'read');
      assert.equal(grants[0].visibility, 'public');
      await page.getByRole('button', { name: 'Close share panel', exact: true }).click();
      assert.equal(await page.locator('#share-pane').isVisible(), false);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`the share dialog is drawn on the theme's surface (${theme})`, async () => {
      reset();
      weave.mintShare({ scope: { kind: 'entity', id: one.id }, label: 'kept' });
      const page = await open(`#/entity/${one.id}`, theme);
      try {
        await painted(page, '.entity-head');
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await fromMenu(page, '.view-header .crumb-row');
        await page.locator('#modal .share-row').first().waitFor();
        const look = await page.evaluate(() => {
          const lum = (c) => {
            const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const box = getComputedStyle(document.querySelector('#modal'));
          const url = getComputedStyle(document.querySelector('#modal .share-url'));
          const chip = getComputedStyle(document.querySelector('#modal .share-chip'));
          return { bg: lum(box.backgroundColor), url: lum(url.color), chip: lum(chip.color) };
        });
        if (theme === 'dark') {
          assert.ok(look.bg < 80, `a dark surface (luminance ${look.bg})`);
          assert.ok(look.url > look.bg + 60 && look.chip > look.bg + 60, `text reads on it: ${JSON.stringify(look)}`);
        } else {
          assert.ok(look.bg > 200, `a light surface (luminance ${look.bg})`);
          assert.ok(look.url < look.bg - 60 && look.chip < look.bg - 60, `text reads on it: ${JSON.stringify(look)}`);
        }
      } finally {
        await page.close();
      }
    });
  }
}
