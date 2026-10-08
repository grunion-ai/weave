import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch, PHONE, phoneBrowser, phonePage, phoneProfile } from './lib/browser.mjs';

const LONG_ERR = "Couldn't open that record: Entity 'does-not-exist' not found";
const STALE_MSG = 'This page was served by bbbbbbb but the server is still running aaaaaaa; restart weave, until then saving can fail silently';

let scratch;
const s = await launch('toast lane', (weave) => {
  weave.state.meta.name = 'main';
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'Task' });
  for (let i = 1; i <= 30; i++) weave.createTable({ space: 'S', name: `Table ${i}` });
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
}, { server: () => ({ workspaces: { scratch } }) });

if (s) {
  const { base, browser } = s;
  const phone = phoneProfile().page.viewport;
  const sizes = [[1440, 900], [phone.width, phone.height, PHONE]];
  async function open(width, height, theme = 'light', device = null) {
    const page = device ? await phonePage(await phoneBrowser()) : await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + '/');
    await page.waitForSelector('#sidebar .nav-health', { state: 'attached' });
    return page;
  }
  const rect = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }), sel);
  const hits = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  const toasts = (page) => page.locator('#wv-toasts .wv-toast');

  for (const [w, h, device] of sizes) {
    test(`${device ?? w}: toasts never touch the bug button or its open panel`, async () => {
      const page = await open(w, h, 'light', device);
      try {
        await page.click('.bug-fab');
        await page.waitForSelector('#bug-panel');
        await page.evaluate(([a, b]) => {
          toast(a, true);
          toast('Deleted Task', false, { label: 'Undo', run() {} });
          toast(b, true);
        }, [LONG_ERR, STALE_MSG]);
        assert.equal(await toasts(page).count(), 3);
        const stack = await rect(page, '#wv-toasts .wv-toast');
        const chrome = [...await rect(page, '.bug-fab'), ...await rect(page, '#bug-panel')];
        assert.equal(chrome.length, 2, 'bug button and open panel are both drawn');
        for (const t of stack) {
          for (const c of chrome) assert.ok(!hits(t, c), `${w}: toast ${JSON.stringify(t)} overlaps ${JSON.stringify(c)}`);
          assert.ok(t.x >= 0 && t.right <= w && t.y >= 0 && t.bottom <= h, `${w}: toast inside the viewport`);
        }
        if (w >= 1000) {
          const main = (await rect(page, '#main'))[0];
          for (const t of stack) {
            assert.ok(t.bottom > h / 2, 'the stack sits at the bottom');
            const mid = (t.x + t.right) / 2, laneMid = (main.x + 24 + w - 300) / 2;
            assert.ok(Math.abs(mid - laneMid) <= 2, `centred in the lane (${mid} vs ${laneMid})`);
          }
          const newest = stack.at(-1);
          assert.ok(stack.every((t) => t.bottom <= newest.bottom + 0.5), 'the newest is nearest the bottom edge');
        } else {
          for (const t of stack) assert.ok(t.y < h / 2, 'below 1000px the stack sits at the top');
          assert.ok(stack.every((t) => t.y >= stack.at(-1).y - 0.5), 'the newest is nearest the top edge');
        }
      } finally { await page.close(); }
    });

    test(`${device ?? w}: a long server error renders whole`, async () => {
      const page = await open(w, h, 'light', device);
      try {
        await page.evaluate((m) => toast(m, true), STALE_MSG);
        const m = await page.evaluate(() => {
          const t = document.querySelector('#wv-toasts .wv-toast');
          const msg = t.querySelector('.wv-toast-msg');
          return { text: msg.textContent, sw: msg.scrollWidth, cw: msg.clientWidth, sh: msg.scrollHeight, ch: msg.clientHeight,
            ellipsis: getComputedStyle(msg).textOverflow, lines: Math.round(msg.getBoundingClientRect().height / parseFloat(getComputedStyle(msg).lineHeight)) };
        });
        assert.ok(m.text.startsWith(STALE_MSG), 'every character of the message is in the toast');
        assert.ok(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `nothing clipped (${m.sw}/${m.cw}, ${m.sh}/${m.ch})`);
        assert.notEqual(m.ellipsis, 'ellipsis');
        assert.ok(m.lines >= 2, `it wraps (${m.lines} lines)`);
      } finally { await page.close(); }
    });
  }

  test('the version chip lives in the sidebar under the stats line', async () => {
    const page = await open(1440, 900);
    try {
      const g = await page.evaluate(() => {
        const chip = document.querySelector('.nav-health');
        return { inSidebar: !!chip.closest('#sidebar'), inCorner: !!chip.closest('#hub-foot'), count: document.querySelectorAll('.nav-health').length,
          stats: document.querySelector('.nav-stats-line').getBoundingClientRect().bottom, chip: chip.getBoundingClientRect().top, title: chip.title };
      });
      assert.deepEqual([g.inSidebar, g.inCorner, g.count], [true, false, 1]);
      assert.ok(g.chip >= g.stats, 'under the stats line');
      assert.match(g.title, /weave instance/, 'the tooltip survives the move');
      await page.evaluate(() => loadSchema());
      assert.equal(await page.locator('#sidebar .nav-health').count(), 1);
      assert.equal(await page.locator('#hub-foot .nav-health').count(), 0);
    } finally { await page.close(); }
  });

  test('the sidebar foot is solid to the bottom edge: no nav row shows under it', async () => {
    const page = await open(1440, 900);
    try {
      const g = await page.evaluate(() => {
        const side = document.querySelector('#sidebar').getBoundingClientRect();
        const foot = document.querySelector('.nav-stats').getBoundingClientRect();
        const below = document.elementFromPoint(foot.x + 40, side.bottom - 3);
        return { footBottom: foot.bottom, sideBottom: side.bottom, scrolls: document.querySelector('#sidebar').scrollHeight > document.querySelector('#sidebar').clientHeight,
          below: below?.closest('.nav-stats') ? 'foot' : (below?.className || below?.tagName) };
      });
      assert.ok(g.scrolls, 'the seed makes the nav scroll');
      assert.ok(g.footBottom >= g.sideBottom - 0.5, `the foot reaches the sidebar's bottom edge (${g.footBottom} vs ${g.sideBottom})`);
      assert.equal(g.below, 'foot', 'the last pixels of the sidebar belong to the foot, not a nav row');
    } finally { await page.close(); }
  });

  test('hovering the stack stops its clock; leaving starts it again', async () => {
    const page = await open(1440, 900);
    try {
      await page.evaluate(() => { TOAST_MS.info = 400; toast('Moved Task to Product'); });
      await page.hover('#wv-toasts .wv-toast');
      await page.waitForTimeout(1000);
      assert.equal(await toasts(page).count(), 1, 'still up after 2.5 times its life, under the pointer');
      await page.mouse.move(5, 5);
      await page.waitForFunction(() => !document.querySelector('#wv-toasts .wv-toast'), null, { timeout: 3000 });
    } finally { await page.close(); }
  });

  test('Esc closes the newest toast; the close button closes its own', async () => {
    const page = await open(1440, 900);
    try {
      await page.evaluate(() => { toast('first'); toast('second'); document.activeElement?.blur(); });
      await page.keyboard.press('Escape');
      assert.deepEqual(await toasts(page).allInnerTexts().then((t) => t.map((x) => x.trim())), ['first']);
      await page.locator('#wv-toasts .wv-toast-close').click();
      assert.equal(await toasts(page).count(), 0);
      await page.evaluate(() => { tray('Edit', [], async () => {}, 'Save changes'); toast('kept'); });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tray-back', { state: 'detached' });
      assert.equal(await toasts(page).count(), 1, 'the tray took that Esc');
    } finally { await page.close(); }
  });

  test('three at most, repeats counted, errors outlive info', async () => {
    const page = await open(1440, 900);
    try {
      await page.evaluate(() => { toast('boom', true); toast('a'); toast('b'); toast('c'); toast('c'); });
      const texts = await toasts(page).allInnerTexts();
      assert.equal(texts.length, 3);
      assert.ok(texts.some((t) => /boom/.test(t)), 'the error stayed');
      assert.ok(!texts.some((t) => /^a/.test(t.trim())), 'the oldest info left');
      assert.match(await page.locator('.wv-toast', { hasText: 'c' }).innerText(), /×2/, 'a repeat counts instead of stacking');
    } finally { await page.close(); }
  });

  test('screen readers hear info politely and errors at once', async () => {
    const page = await open(1440, 900);
    try {
      await page.evaluate(() => { toast('Moved Task to Product'); toast('boom', true); });
      await page.waitForFunction(() => document.querySelector('#wv-live-status')?.textContent && document.querySelector('#wv-live-alert')?.textContent);
      const live = await page.evaluate(() => ({
        status: [document.querySelector('#wv-live-status').getAttribute('role'), document.querySelector('#wv-live-status').getAttribute('aria-live'), document.querySelector('#wv-live-status').textContent],
        alert: [document.querySelector('#wv-live-alert').getAttribute('role'), document.querySelector('#wv-live-alert').textContent],
        close: document.querySelector('.wv-toast-close').getAttribute('aria-label'),
      }));
      assert.deepEqual(live, { status: ['status', 'polite', 'Moved Task to Product'], alert: ['alert', 'boom'], close: 'Dismiss' });
    } finally { await page.close(); }
  });

  for (const [w, h, device] of sizes) {
    test(`${device ?? w}: an open tray keeps the corner and the toasts off Save changes`, async () => {
      const page = await open(w, h, 'light', device);
      try {
        await page.evaluate((m) => { tray('Edit Description', [], async () => {}, 'Save changes'); toast(m, true); }, LONG_ERR);
        const bar = (await rect(page, '#tray .tray-actions'))[0];
        const save = (await rect(page, '#tray .tray-actions .btn-primary'))[0];
        const fab = (await rect(page, '.bug-fab'))[0];
        assert.ok(!hits(fab, bar), `the bug button clears the tray's action bar (${JSON.stringify(fab)} vs ${JSON.stringify(bar)})`);
        for (const t of await rect(page, '#wv-toasts .wv-toast')) {
          assert.ok(!hits(t, save), 'no toast on Save changes');
          assert.ok(!hits(t, fab), 'nor on the bug button');
        }
      } finally { await page.close(); }
    });
  }

  test('toasts draw from theme tokens in both themes', async () => {
    const colours = {};
    for (const theme of ['light', 'dark']) {
      const page = await open(1440, 900, theme);
      try {
        colours[theme] = await page.evaluate(() => {
          toast('boom', true);
          const t = document.querySelector('.wv-toast.err');
          const cs = getComputedStyle(t);
          return { bg: cs.backgroundColor, fg: cs.color, icon: getComputedStyle(t.querySelector('.wv-toast-icon')).color };
        });
      } finally { await page.close(); }
    }
    assert.notEqual(colours.light.bg, colours.dark.bg, 'the surface flips with the theme');
    assert.notEqual(colours.light.fg, colours.light.bg);
    assert.notEqual(colours.dark.fg, colours.dark.bg);
    assert.notEqual(colours.light.icon, colours.light.fg, 'an error says so in its icon');
  });
}
