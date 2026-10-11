import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

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
    await page.locator('.dl-menu:not(.hidden) .dropdown-item', { hasText: 'Share…' }).click();
  };
  const dialog = (page) => page.locator('#modal');
  const reset = () => { for (const g of weave.listShares()) weave.revokeShare(g.id); };

  test('the entity page opens the share dialog: the mode ladder with comment held back, a private toggle, then mint and revoke', async () => {
    reset();
    const page = await open(`#/entity/${one.id}`);
    try {
      await painted(page, '.entity-head');
      await fromMenu(page, '.view-header .crumb-actions');
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
      assert.equal(await eventually(() => weave.listShares().length, 0), 0);
      await page.locator('#modal .share-hint', { hasText: 'No links yet' }).waitFor();
    } finally {
      await page.close();
    }
  });

  test('the table, space and saved-view pages open the same dialog on their own scope', async () => {
    reset();
    const cases = [
      [`#/table/${task.id}`, async (page) => fromMenu(page, '.view-header .crumb-actions'), 'table', task.id],
      [`#/space/${space.id}`, async (page) => page.locator('.view-header .share-btn').click(), 'space', space.id],
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

  for (const theme of ['light', 'dark']) {
    test(`the share dialog is drawn on the theme's surface (${theme})`, async () => {
      reset();
      weave.mintShare({ scope: { kind: 'entity', id: one.id }, label: 'kept' });
      const page = await open(`#/entity/${one.id}`, theme);
      try {
        await painted(page, '.entity-head');
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await fromMenu(page, '.view-header .crumb-actions');
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
