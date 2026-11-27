import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { DESKTOP_MIN, PHONE_MAX, WIDTH } from './lib/viewports.mjs';

let tasks, row;
const s = await launch('shell breakpoints', (weave) => {
  weave.createSpace({ name: 'Backlog', icon: 'lucide:list-checks' });
  tasks = weave.createTable({ space: 'Backlog', name: 'Tasks', icon: 'lucide:square-check' });
  row = weave.createEntity(tasks, { name: 'AMEX CC Migration' });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const shell = (page) => page.evaluate(() => {
    const seen = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
    const menu = document.querySelector('#main .view-header .nav-menu');
    return {
      tray: seen(document.querySelector('#sidebar')),
      collapsed: document.querySelector('#app').classList.contains('nav-collapsed'),
      trayButton: seen(menu),
      trayButtonWidth: menu ? Math.round(menu.getBoundingClientRect().width) : 0,
      workspaceCrumb: seen(document.querySelector('#main .view-header .crumb-k-ws')),
      crumbHeight: Math.round(document.querySelector('#main .view-header .crumb-path > .crumb-slot:last-child > .crumb-item').getBoundingClientRect().height),
      rowHeight: Math.round(document.querySelector('#main .view-header .crumb-row').getBoundingClientRect().height),
      pref: localStorage.getItem('weave-nav-collapsed'),
    };
  });
  const open = async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .view-header .crumb-path > .crumb-slot:last-child > .crumb-item');
    await settle(page);
    return page;
  };
  const resize = async (page, width) => { await page.setViewportSize({ width, height: 900 }); await settle(page); };

  test('phone format applies below 720 px and desktop format from 720 px up (Feature #379)', async () => {
    const page = await open(PHONE_MAX);
    try {
      const phone = await shell(page);
      assert.equal(phone.tray, false, 'no nav tray in phone format');
      assert.equal(phone.workspaceCrumb, false, 'phone format drops the workspace crumb');
      assert.equal(phone.crumbHeight, 36, 'crumbs are 36px chips in phone format');
      assert.equal(phone.trayButtonWidth, 44, 'the navigation button is a 44px target');
      assert.equal(await page.evaluate(() => matchMedia('(max-width: 719px)').matches), true);
      await page.addStyleTag({ content: '#main .view-header .nav-menu.held { min-width: 44px !important; }' });
      await page.evaluate(() => {
        const menu = document.querySelector('#main .view-header .nav-menu');
        menu.classList.add('held');
        addEventListener('resize', () => setTimeout(() => menu.classList.remove('held'), 300), { once: true });
      });
      await resize(page, DESKTOP_MIN);
      await page.waitForFunction(() => {
        const menu = document.querySelector('#main .view-header .nav-menu');
        return !!menu && menu.getBoundingClientRect().width < 44 && menu.getAnimations().every((a) => a.playState !== 'running');
      }, null, { timeout: 5000 }).catch(() => {});
      const desk = await shell(page);
      assert.equal(desk.workspaceCrumb, true, 'desktop format shows the workspace crumb');
      assert.ok(desk.crumbHeight < 36, `desktop crumbs are text, not chips: ${desk.crumbHeight}px`);
      assert.ok(desk.trayButtonWidth < 44, `the tray button is desktop sized: ${desk.trayButtonWidth}px`);
    } finally { await page.close(); }
  });

  test('each of two side-by-side windows on a 14-inch laptop gets desktop format with the tray hidden (Feature #379)', async () => {
    const page = await open(WIDTH.halfLaptop);
    try {
      const half = await shell(page);
      assert.equal(half.workspaceCrumb, true, 'a half-screen window shows the desktop crumbs');
      assert.ok(half.crumbHeight < 36, `desktop crumbs are text, not chips: ${half.crumbHeight}px`);
      assert.ok(half.trayButtonWidth < 44, `the tray button is desktop sized: ${half.trayButtonWidth}px`);
      assert.equal(half.tray, false, 'the tray hides on its own');
      assert.equal(half.collapsed, true, 'through the collapsed state');
      assert.ok(!half.pref, 'and leaves the saved preference alone');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page does not scroll sideways');
      await page.click('#main .view-header .nav-menu');
      await settle(page);
      assert.equal((await shell(page)).tray, true, 'the tray button shows the tray beside the page');
    } finally { await page.close(); }
  });

  test('the nav tray hides on its own below 1200 px, keeps its toggle, and returns at 1200 px (Feature #377)', async () => {
    const page = await open(1400);
    try {
      const wide = await shell(page);
      assert.equal(wide.tray, true, 'the tray shows on a wide window');
      assert.equal(wide.trayButton, false, 'and the header carries no tray button');
      await resize(page, 1199);
      const tight = await shell(page);
      assert.equal(tight.tray, false, 'the tray hides below 1200px');
      assert.equal(tight.collapsed, true, 'through the same collapsed state the toggle uses');
      assert.equal(tight.trayButton, true, 'and the header shows the tray button');
      assert.ok(!tight.pref, `hiding on its own does not rewrite the saved preference: ${tight.pref}`);
      await page.click('#main .view-header .nav-menu');
      await settle(page);
      const shown = await shell(page);
      assert.equal(shown.tray, true, 'the tray button still shows the tray');
      assert.ok(shown.rowHeight <= tight.rowHeight + 1, `and the header stays on one row: ${shown.rowHeight} vs ${tight.rowHeight}`);
      assert.ok(!shown.pref, 'a choice made in a tight window stays out of the saved preference');
      await resize(page, 1100);
      await resize(page, 1200);
      assert.equal((await shell(page)).tray, true, 'the tray returns at 1200px');
    } finally { await page.close(); }
  });

  test('a tray the user hid stays hidden at every desktop width (Feature #377)', async () => {
    const page = await open(1400);
    try {
      await page.click('#nav-collapse');
      await settle(page);
      assert.equal((await shell(page)).pref, '1');
      await resize(page, 1100);
      await resize(page, 1400);
      const back = await shell(page);
      assert.equal(back.tray, false, 'the saved preference wins on a wide window');
      assert.equal(back.pref, '1');
    } finally { await page.close(); }
  });
}
