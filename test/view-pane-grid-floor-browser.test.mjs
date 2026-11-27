import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { WIDTH, showTray } from './lib/viewports.mjs';
import { openPane, closePane } from './lib/view-pane.mjs';

const FLOOR = 480;
let tasks;
const s = await launch('the table keeps a 480 px floor beside the View pane (Issue #1925)', (weave) => {
  weave.createSpace({ name: 'Backlog' });
  tasks = weave.createTable({ space: 'Backlog', name: 'Tasks' });
  weave.addField(tasks, { name: 'State', type: 'select', config: { options: ['Open', 'Done'] } });
  for (let i = 0; i < 20; i++) weave.createEntity(tasks, { name: `Task ${i}`, values: { State: i % 2 ? 'Open' : 'Done' } });
});

if (s) {
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const shell = (page) => page.evaluate(() => {
    const app = document.querySelector('#app');
    const main = document.querySelector('#main').getBoundingClientRect();
    const pane = document.querySelector('#view-pane');
    const box = pane.getBoundingClientRect();
    return {
      main: Math.round(main.width),
      tray: getComputedStyle(document.querySelector('#sidebar')).display !== 'none',
      pane: !pane.hidden && box.width > 0,
      paneRight: Math.round(box.right),
      floated: getComputedStyle(pane).position === 'fixed',
      overflow: app.scrollWidth - app.clientWidth,
      navPref: localStorage.getItem('weave-nav-collapsed'),
      panePref: localStorage.getItem('weave-view-pane'),
    };
  });
  const open = async (width, ready = '#main .wv-grid') => {
    const page = await s.browser.newPage({ viewport: { width, height: 768 } });
    await page.goto(`${s.base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await settle(page);
    return page;
  };

  test('1024 px, tray shown by hand, then the View pane opens: the tray hides so the table keeps its floor (Issue #1925)', async () => {
    const page = await open(1024);
    try {
      await showTray(page);
      await settle(page);
      assert.equal((await shell(page)).tray, true, 'the tray button shows the tray');
      await openPane(page);
      await settle(page);
      const got = await shell(page);
      assert.equal(got.pane, true, 'the View pane is open');
      assert.equal(got.floated, false, 'beside the table, not over it');
      assert.equal(got.tray, false, 'the tray hides to make room');
      assert.ok(got.main >= FLOOR, `the table is ${got.main}px, under its ${FLOOR}px floor`);
      assert.ok(got.overflow <= 0, `the pane row runs ${got.overflow}px past the window`);
      assert.ok(!got.navPref, `hiding on its own leaves the saved tray preference alone: ${got.navPref}`);
      assert.equal(got.panePref, 'open', 'the View pane keeps what it stores');
    } finally { await page.close(); }
  });

  test('1024 px, View pane open, then the tray shown by hand: the tray stays and the View pane floats over the table (Issue #1925)', async () => {
    const page = await open(1024);
    try {
      await openPane(page);
      await showTray(page);
      await settle(page);
      const got = await shell(page);
      assert.equal(got.tray, true, 'the tray button still shows the tray');
      assert.equal(got.pane, true, 'the View pane stays open');
      assert.equal(got.floated, true, 'the View pane floats over the table');
      assert.ok(got.paneRight <= 1024, 'inside the window');
      assert.ok(got.main >= FLOOR, `the table is ${got.main}px, under its ${FLOOR}px floor`);
      await closePane(page);
      await settle(page);
      const back = await shell(page);
      assert.equal(back.tray, true, 'closing the pane leaves the tray where the user put it');
    } finally { await page.close(); }
  });

  test(`${WIDTH.desktop} px with the tray shown: opening the View pane changes nothing else (Issue #1925)`, async () => {
    const page = await open(WIDTH.desktop);
    try {
      await openPane(page);
      await settle(page);
      const got = await shell(page);
      assert.equal(got.tray, true, 'the tray stays on a wide window');
      assert.equal(got.floated, false, 'the View pane sits beside the table');
      assert.ok(got.main >= FLOOR, `the table is ${got.main}px`);
    } finally { await page.close(); }
  });

  test('1024 px, tray shown, board with the View pane open: the board keeps the same floor (Issue #1925)', async () => {
    s.weave.tableView(`${tasks.id}/Standard`, { layout: 'board' });
    const page = await open(1024, '#main .board-cards > *');
    try {
      await showTray(page);
      await openPane(page);
      await settle(page);
      const got = await shell(page);
      assert.equal(got.pane, true, 'the View pane is open');
      assert.ok(got.main >= FLOOR, `the board is ${got.main}px, under its ${FLOOR}px floor`);
    } finally {
      await page.close();
      s.weave.tableView(`${tasks.id}/Standard`, { layout: null });
    }
  });
}
