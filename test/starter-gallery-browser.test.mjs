import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seed } from '../scripts/seed.mjs';

await import('../public/starter-core.js');
const { TEMPLATES, CATEGORIES } = globalThis.WeaveStarters;

const s = await launch('starter gallery: a workspace already in use', (weave) => {
  seed(weave);
  weave.markOnboarded();
});

async function open(hash, { theme = 'light', viewport = null } = {}) {
  const page = await s.browser.newPage(viewport ? { viewport, isMobile: true, hasTouch: true } : {});
  await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
  await page.goto(`${s.base}/${hash}`);
  await page.waitForSelector('.view-header');
  return page;
}

if (s) {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: the sidebar's Templates link opens a gallery of every starter, grouped by category`, async () => {
      const page = await open('#/', { theme });
      const link = page.locator('.nav-foot a.wv-gallery-link');
      assert.equal((await link.textContent()).trim(), 'Templates');
      await link.click();
      await page.waitForFunction(() => location.hash === '#/templates');
      await page.waitForSelector('.wv-gallery .wv-start-template');
      assert.equal(await page.locator('.view-header .view-title').inputValue(), 'Templates');
      const groups = await page.locator('.wv-gallery .wv-gallery-group > .wv-start-label').allTextContents();
      assert.deepEqual(groups, CATEGORIES.filter((c) => TEMPLATES.some((t) => t.category === c.id)).map((c) => c.label));
      assert.equal(await page.locator('.wv-gallery .wv-start-template').count(), TEMPLATES.length, 'every starter has a card');
      const card = page.locator('.wv-gallery .wv-start-template[data-template="tasks"]');
      assert.equal((await card.locator('.wv-start-title').textContent()).trim(), 'Work');
      assert.equal((await card.locator('.wv-start-blurb').textContent()).trim(), TEMPLATES.find((t) => t.id === 'tasks').blurb);
      const [fg, bg] = await card.evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
      assert.notEqual(fg, bg, `${theme}: card text and ground differ`);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
      await page.close();
    });
  }

  test('a starter from the gallery builds into the workspace already in use and opens it; its card then opens the space', async () => {
    const before = s.weave.userTables().length;
    const page = await open('#/templates');
    await page.waitForSelector('.wv-gallery .wv-start-template[data-template="tasks"]');
    const builds = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/build')) builds.push(r.url()); });
    await page.dblclick('.wv-gallery .wv-start-template[data-template="tasks"]');
    await page.waitForFunction(() => location.hash.startsWith('#/table/'));
    assert.equal(builds.length, 1, 'one build, once on a double click');
    const tasks = s.weave.findTable('Work/Tasks');
    assert.ok(tasks, 'Work/Tasks exists');
    assert.ok(page.url().endsWith(`#/table/${tasks.id}`), 'landed on it');
    assert.equal(s.weave.userTables().length, before + 1, 'the tables already there stay');
    await page.goto(`${s.base}/#/templates`);
    const card = page.locator('.wv-gallery a.wv-start-template[data-template="tasks"]');
    await card.waitFor();
    assert.match(await card.textContent(), /In this workspace/);
    assert.ok((await card.getAttribute('href')).endsWith(`#/space/${s.weave.getSpace('Work').id}`), 'the card opens the space instead of building it twice');
    s.weave.deleteSpace('Work', { hard: true });
    await page.close();
  });

  {
    test('at 375 px the gallery stacks one card a row and never scrolls sideways', async () => {
      const page = await open('#/templates', { viewport: { width: 375, height: 812 } });
      await page.waitForSelector('.wv-gallery .wv-start-template');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
      const lefts = await page.locator('.wv-gallery .wv-gallery-group').first().locator('.wv-start-template').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      assert.equal(new Set(lefts).size, 1, 'one column');
      await page.close();
    });
  }
}
