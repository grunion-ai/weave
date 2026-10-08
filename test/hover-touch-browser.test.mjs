import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('touch screens skip hover reveals', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  const features = weave.createTable({ space: 'Development', name: 'Feature' });
  weave.createEntity(issues, { name: 'First issue' });
  weave.createEntity(features, { name: 'First feature' });
  return { hash: `#/table/${issues.id}`, other: features.id };
});

const look = (page, id) => page.evaluate((id) => {
  const row = document.querySelector(`#sidebar .nav-db[href="#/table/${id}"]`);
  const menu = row?.querySelector('.nav-db-menu');
  const add = document.querySelector('#sidebar .nav-add-table');
  return {
    theme: document.documentElement.dataset.bsTheme,
    row: !!row,
    menu: menu ? getComputedStyle(menu).opacity : null,
    add: add ? getComputedStyle(add).opacity : null,
    styles: row ? [...row.querySelectorAll('*')].map((n) => { const c = getComputedStyle(n); return `${c.opacity}|${c.visibility}|${c.display}|${c.transform}`; }).join(';') : '',
  };
}, id);

if (s) {
  const { base, browser, hash, other } = s;
  const engines = [['chromium 390x844 touch', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a touch phone a table in the menu opens on one tap, and its row menu shows without a hover (${engine}, ${theme}, Issue #728)`, async () => {
        const page = await open(b, profile, theme);
        try {
          assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'the profile is a touch screen');
          await page.tap('#main .nav-menu');
          await page.waitForSelector(`#sidebar .nav-db[href="#/table/${other}"]`);
          const before = await look(page, other);
          assert.equal(before.theme, theme);
          assert.equal(before.menu, '1', 'the row menu is visible on touch, so it never waits for a hover');
          assert.equal(before.add, '1', 'and so is the add-table button');
          await page.hover(`#sidebar .nav-db[href="#/table/${other}"]`);
          const after = await look(page, other);
          assert.equal(after.styles, before.styles, 'a hover changes nothing that iOS would read as revealed content');
          await page.tap(`#sidebar .nav-db[href="#/table/${other}"]`, { position: { x: 24, y: 12 } });
          await page.waitForFunction((id) => location.hash.startsWith(`#/table/${id}`), other, { timeout: 5000 });
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the table row menu still appears on hover (Issue #728)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } }, 'light');
    try {
      await page.waitForSelector(`#sidebar .nav-db[href="#/table/${other}"]`);
      assert.equal((await look(page, other)).menu, '0', 'hidden at rest');
      await page.hover(`#sidebar .nav-db[href="#/table/${other}"]`);
      await page.waitForFunction((id) => getComputedStyle(document.querySelector(`#sidebar .nav-db[href="#/table/${id}"] .nav-db-menu`)).opacity === '1', other, { timeout: 3000 });
    } finally { await page.close(); }
  });
}
