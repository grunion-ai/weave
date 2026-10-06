import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let scratch;
const s = await launch('workspace delete', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.createSpace({ name: 'Notes' });
}, { server: () => ({ workspaces: { scratch } }) });

if (s) {
  const { base, browser } = s;

  async function open(path = '/', theme = 'light') {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + path);
    await page.waitForSelector('#ws-list .ws-icon');
    return page;
  }
  const chip = (page, name) => page.locator(`#ws-list .ws-icon[title^="${name} "]`);
  const menuItems = (page) => page.locator('.ws-ctx .dropdown-item').allTextContents();

  test('right-click on a sibling chip offers Delete; the default chip does not', async () => {
    const page = await open();
    await chip(page, 'scratch').click({ button: 'right' });
    assert.ok((await menuItems(page)).some((t) => /Delete workspace/.test(t)), 'scratch offers a delete');
    await page.keyboard.press('Escape');
    await chip(page, 'main').click({ button: 'right' });
    const items = await menuItems(page);
    assert.ok(!items.some((t) => /Delete workspace/.test(t)), `the default offers no delete: ${items}`);
    assert.ok(items.some((t) => /logo/i.test(t)), 'the current workspace still offers its logo');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ws-ctx').count(), 0, 'Escape closes the menu');
    await page.close();
  });

  test('delete confirms by typing the name, then the trash chip offers restore — in dark too', async () => {
    const page = await open('/', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), 'dark');
    await chip(page, 'scratch').click({ button: 'right' });
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Delete workspace' }).click();
    await page.waitForSelector('#modal input[name="confirm"]');
    await page.fill('#modal input[name="confirm"]', 'scratchy');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('.wv-toast.err');
    assert.equal(await page.locator('#modal').count(), 1, 'the dialog stays open on a wrong name');
    assert.equal(await chip(page, 'scratch').count(), 1);
    await page.fill('#modal input[name="confirm"]', 'scratch');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('#ws-trash');
    assert.equal(await chip(page, 'scratch').count(), 0, 'the deleted workspace leaves the rail');
    const res = await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json());
    assert.ok(res.find((w) => w.name === 'scratch')?.deletedAt, 'the server holds the tombstone');
    await assertTrashInCorner(page, 'dark');
    await page.click('#ws-trash');
    await page.locator('#modal button', { hasText: 'Restore' }).click();
    await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
    assert.equal(await page.locator('#ws-trash').count(), 0, 'an empty trash shows no chip');
    await page.close();
  });

  async function assertTrashInCorner(page, theme) {
    assert.equal(await page.locator('#ws-rail #ws-trash').count(), 0, `${theme}: no trash in the chip column`);
    const g = await page.evaluate(() => {
      const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; };
      const t = document.querySelector('#ws-trash');
      const cs = getComputedStyle(t);
      return { trash: box('#ws-trash'), bug: box('.bug-fab'), healthInSidebar: !!document.querySelector('.nav-health')?.closest('#sidebar'), toggle: box('#theme-toggle'), visible: cs.visibility !== 'hidden' && cs.display !== 'none', title: t.title, color: cs.color };
    });
    assert.ok(g.visible && g.trash.w > 0 && g.trash.h > 0, `${theme}: the trash glyph is drawn`);
    assert.ok(g.trash.y > g.bug.y + g.bug.h - 1, `${theme}: below the bug button (${g.trash.y} vs ${g.bug.y + g.bug.h})`);
    assert.ok(Math.abs(g.trash.right - g.bug.right) <= 1, `${theme}: under the bug button (${g.trash.right} vs ${g.bug.right})`);
    assert.ok(g.healthInSidebar, `${theme}: the version tag is in the sidebar`);
    assert.equal(Math.round(g.trash.h), Math.round(g.bug.h), `${theme}: the bug button's height`);
    assert.ok(g.trash.h < g.toggle.h, `${theme}: smaller than a rail chip (${g.trash.h} vs ${g.toggle.h})`);
    assert.equal(g.title, 'Trashed workspaces (1)');
    const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tblr-danger').trim());
    const dangerRgb = await page.evaluate((d) => { const s = document.createElement('span'); s.style.color = d; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, danger);
    assert.notEqual(g.color, dangerRgb, `${theme}: muted at rest, not red`);
    await page.hover('#ws-trash');
    await page.waitForFunction((rest) => getComputedStyle(document.querySelector('#ws-trash')).color !== rest, g.color, { timeout: 2000 })
      .catch(() => assert.fail(`${theme}: hover changes the colour`));
    await page.waitForTimeout(200);
    const hover = await page.evaluate(() => getComputedStyle(document.querySelector('#ws-trash')).color);
    assert.equal(hover, dangerRgb, `${theme}: red on hover`);
    await page.mouse.move(0, 0);
  }

  test('with one trashed workspace the glyph sits in the corner cluster — light theme', async () => {
    const { id, deletedAt } = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
    if (!deletedAt) await fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE' });
    const page = await open('/', 'light');
    await page.waitForSelector('#ws-trash');
    await assertTrashInCorner(page, 'light');
    await fetch(`${base}/api/workspaces/${id}/restore`, { method: 'POST' });
    await page.close();
  });

  test('the workspace page carries the same delete; the default page has none', async () => {
    const list = await fetch(`${base}/api/workspaces`).then((r) => r.json());
    const row = list.find((w) => w.name === 'scratch');
    const page = await open(`/w/${row.id}/`);
    await page.waitForSelector('.view-header .dots-btn');
    await page.click('.view-header .dots-btn');
    assert.ok(await page.locator('.dl-menu .dropdown-item', { hasText: 'Delete workspace' }).count(), 'scratch page offers delete');
    await page.close();
    const home = await open('/');
    await home.waitForSelector('.view-header');
    assert.equal(await home.locator('.dl-menu .dropdown-item', { hasText: 'Delete workspace' }).count(), 0, 'the default page offers none');
    await home.close();
  });
}
