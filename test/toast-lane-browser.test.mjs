/* Issue #380 (design pass finding F3): fixed corner chrome covered content.
   The version chip sat on the grid's "200 of 333 loaded" note, the bug
   button sat on Save changes, and a toast (fixed at bottom 18, right 48)
   landed on the open bug panel at 390px. The approved design (Kyle,
   2026-09-26): the chip moves into the sidebar under the stats line, bug and
   trash keep the corner, and toasts get a lane. At 1000px and wider the lane
   runs between the content panel and a 300px corner reserve and the stack
   centres at its bottom; below 1000px it moves to the top of the screen.
   Every toast behaves the same: a close button, Esc, a clock that pauses
   under the pointer, three at most, repeats counted, live regions for
   screen readers.

   Playwright is NOT a dependency of weave; the harness skips the suite when
   it is absent, so `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

const LONG_ERR = "Couldn't open that record: Entity 'does-not-exist' not found";
const STALE_MSG = 'This page was served by bbbbbbb but the server is still running aaaaaaa; restart weave, until then saving can fail silently';

let scratch;
const s = await launch('toast lane', (weave) => {
  weave.state.meta.name = 'main';
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'Task' });
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
}, { server: () => ({ workspaces: { scratch } }) });

if (s) {
  const { base, browser } = s;
  // A workspace in the trash, so the trash glyph is drawn in the corner.
  const trashScratch = async () => {
    const { id, deletedAt } = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
    if (!deletedAt) await fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE' });
  };

  async function open(width, height, theme = 'light') {
    await trashScratch();
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + '/');
    // Below 900px the sidebar is a drawer, closed at rest: the chip rides in it.
    await page.waitForSelector('#sidebar .nav-health', { state: 'attached' });
    await page.waitForSelector('#ws-trash');
    return page;
  }
  const rect = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }), sel);
  const hits = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  const toasts = (page) => page.locator('#wv-toasts .wv-toast');

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    test(`${w}: toasts never touch the bug button, its open panel or the trash`, async () => {
      const page = await open(w, h);
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
        const chrome = [...await rect(page, '.bug-fab'), ...await rect(page, '#bug-panel'), ...await rect(page, '#ws-trash')];
        assert.equal(chrome.length, 3, 'bug button, open panel and trash are all drawn');
        for (const t of stack) {
          for (const c of chrome) assert.ok(!hits(t, c), `${w}: toast ${JSON.stringify(t)} overlaps ${JSON.stringify(c)}`);
          assert.ok(t.x >= 0 && t.right <= w && t.y >= 0 && t.bottom <= h, `${w}: toast inside the viewport`);
        }
        if (w >= 1000) {
          // Bottom lane, centred between the content panel and the corner reserve.
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

    test(`${w}: a long server error renders whole`, async () => {
      const page = await open(w, h);
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
      // A re-render of the nav keeps the one chip.
      await page.evaluate(() => loadSchema());
      assert.equal(await page.locator('#sidebar .nav-health').count(), 1);
      assert.equal(await page.locator('#hub-foot .nav-health').count(), 0);
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
      // Esc belongs to an open tray first: it closes the tray and leaves the toast.
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

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    test(`${w}: an open tray keeps the corner and the toasts off Save changes`, async () => {
      const page = await open(w, h);
      try {
        await page.evaluate((m) => { tray('Edit Description', [], async () => {}, 'Save changes'); toast(m, true); }, LONG_ERR);
        const bar = (await rect(page, '#tray .tray-actions'))[0];
        const save = (await rect(page, '#tray .tray-actions .btn-primary'))[0];
        const fab = (await rect(page, '.bug-fab'))[0];
        assert.ok(!hits(fab, bar), `the bug button clears the tray's action bar (${JSON.stringify(fab)} vs ${JSON.stringify(bar)})`);
        assert.equal(await page.locator('#hub-foot').isVisible(), false, 'the trash steps away while the tray is open');
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
