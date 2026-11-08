import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, openBugReport } from './lib/browser.mjs';

let tasks;
const s = await launch('while connected', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.createEntity(tasks, { name: 'Bluefin one' });
});

const COUNT_WINDOW_LISTENERS = () => {
  const live = new Map();
  const add = window.addEventListener;
  const rm = window.removeEventListener;
  const key = (type, opts) => `${type}|${typeof opts === 'object' ? !!opts?.capture : !!opts}`;
  window.addEventListener = function (type, fn, opts) {
    (live.get(fn) ?? live.set(fn, new Set()).get(fn)).add(key(type, opts));
    return add.call(window, type, fn, opts);
  };
  window.removeEventListener = function (type, fn, opts) {
    live.get(fn)?.delete(key(type, opts));
    return rm.call(window, type, fn, opts);
  };
  window.__windowListeners = (type) => [...live.values()].filter((set) => [...set].some((k) => k.startsWith(`${type}|`))).length;
};

if (s) {
  const { base, browser } = s;
  const FRAME = `data:text/html,${encodeURIComponent('<a href="#a">first</a>')}`;
  const open = async (hash = '') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(COUNT_WINDOW_LISTENERS);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#ws-new svg');
    return page;
  };
  const keydowns = (page) => page.evaluate(() => window.__windowListeners('keydown'));
  const dismissed = async (page, gone, baseline) => {
    await page.keyboard.press('Escape');
    await page.waitForSelector(gone, { state: 'detached' });
    await page.keyboard.press('Shift');
    assert.equal(await eventually(() => keydowns(page), baseline), baseline, `${gone} leaves no keydown listener on the window`);
  };

  const surfaces = [
    ['modal', '#modal-back', (page) => page.evaluate(() => modal('Escape probe', [el('input', { name: 'probe' })], async () => {}))],
    ['tray', '#tray-back', (page) => page.evaluate(() => tray('Escape probe', [el('input', { name: 'probe' })], async () => {}))],
    ['full-screen viewer', '#fsv-back', async (page) => {
      await page.evaluate((url) => fullscreenViewer('Escape probe', { url }), FRAME);
      await page.waitForSelector('#fsv-back iframe');
    }],
    ['bug panel', '#bug-panel', (page) => openBugReport(page)],
  ];

  for (const [name, gone, show] of surfaces) {
    test(`Escape closes the ${name} and its window listeners unhook, twice over (Issue #663)`, async () => {
      const page = await open();
      try {
        const baseline = await keydowns(page);
        for (let round = 1; round <= 2; round++) {
          await show(page);
          await page.waitForSelector(gone);
          assert.ok(await keydowns(page) > baseline, `round ${round}: the open ${name} listens for keys`);
          await dismissed(page, gone, baseline);
        }
      } finally { await page.close(); }
    });
  }

  test('a grid unhooks its Escape and mouseup listeners once the table page is left (Issue #663)', async () => {
    const page = await open();
    try {
      const keys = await keydowns(page);
      const ups = await page.evaluate(() => window.__windowListeners('mouseup'));
      await page.goto(`${base}/#/table/${tasks.id}`);
      await page.waitForSelector('.wv-grid .add-field-btn');
      assert.ok(await keydowns(page) > keys, 'the grid listens for Escape on the window');
      await page.goto(`${base}/#/`);
      await page.waitForSelector('.wv-grid', { state: 'detached' });
      await page.keyboard.press('Shift');
      await page.mouse.down();
      await page.mouse.up();
      assert.equal(await page.evaluate(() => window.__windowListeners('mouseup')), ups, 'the fill-drag mouseup listener is gone');
    } finally { await page.close(); }
  });
}
