import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let notes;
const s = await launch('hold-to-confirm release', (weave) => {
  weave.createSpace({ name: 'Product' });
  notes = weave.createTable({ space: 'Product', name: 'Note' });
});
if (s) {
  const { base, browser, weave } = s;
  const exists = (id) => !!weave.state.entities[id];

  const trashed = (name) => {
    const e = weave.createEntity(notes, { name });
    weave.deleteEntity(e.id);
    return e.id;
  };
  const openPurge = async (name, theme = 'light') => {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/settings`);
    await page.locator('#main .settings-purge tr.purge-row', { hasText: name }).locator('.purge-open').click();
    await page.locator('#main .purge-confirm input').fill(name);
    const hold = page.locator('#main .purge-confirm .hold-btn');
    await hold.waitFor();
    assert.equal((await hold.textContent()).trim(), 'Delete forever', 'permanent delete is the one hold left, in Settings (Features #295, #296)');
    return { page, hold };
  };

  const holdFor = async (ms, name) => {
    const id = trashed(name);
    const { page, hold } = await openPurge(name);
    try {
      await hold.hover();
      if (ms < 900) {
        await hold.evaluate((btn) => new MutationObserver(() => {
          if (btn.classList.contains('holding')) for (const a of btn.querySelector('.hold-fill').getAnimations()) a.playbackRate = 0.25;
        }).observe(btn, { attributes: true, attributeFilter: ['class'] }));
      }
      await page.mouse.down();
      await page.waitForSelector('.hold-btn.holding');
      if (ms < 900) {
        const fill = await hold.locator('.hold-fill').elementHandle();
        await page.waitForFunction(([f, t]) => (f.getAnimations()[0]?.currentTime ?? 0) >= t, [fill, ms], { polling: 'raf' });
        await page.mouse.up();
        await page.waitForTimeout((900 - ms) * 4 + 500);
        return exists(id);
      }
      await page.waitForSelector('.hold-btn.holding', { state: 'detached' }).catch(() => {});
      await page.mouse.up();
      return eventually(() => exists(id), false);
    } finally {
      await page.close();
    }
  };

  test('release past the halfway mark cancels the purge', async () => {
    assert.ok(await holdFor(550, 'Halfway'), 'released at 550ms of 900 — the record must survive');
  });

  test('release just shy of the end cancels the purge', async () => {
    assert.ok(await holdFor(700, 'AlmostDone'), 'released at 700ms of 900 — the record must survive');
  });

  test('a hold carried to the end fires the purge', async () => {
    assert.equal(await holdFor(1300, 'HeldToEnd'), false, 'held past 900ms — the record is gone for good');
  });

  test('drifting off the button and releasing there still cancels', async () => {
    const id = trashed('DriftOff');
    const { page, hold } = await openPurge('DriftOff');
    try {
      await hold.hover();
      await page.mouse.down();
      await page.waitForTimeout(400);
      await page.mouse.move(600, 300, { steps: 4 });
      await page.waitForTimeout(200);
      await page.mouse.up();
      await page.waitForTimeout(1300);
      assert.ok(exists(id), 'the release, wherever it lands, cancels the hold');
    } finally {
      await page.close();
    }
  });

  test('a hold whose sweep the browser never runs still fires the purge (Issue #1439)', async () => {
    const id = trashed('NoSweep');
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const kill = () => {
        const tag = document.createElement('style');
        tag.textContent = '.hold-btn.holding .hold-fill { transition-duration: 0s !important; }';
        document.head.append(tag);
      };
      if (document.head) kill();
      else document.addEventListener('DOMContentLoaded', kill, { once: true });
    });
    try {
      await page.goto(`${base}/#/settings`);
      await page.locator('#main .settings-purge tr.purge-row', { hasText: 'NoSweep' }).locator('.purge-open').click();
      await page.locator('#main .purge-confirm input').fill('NoSweep');
      const hold = page.locator('#main .purge-confirm .hold-btn');
      await hold.waitFor();
      await hold.hover();
      await page.mouse.down();
      await page.waitForSelector('.hold-btn.holding');
      assert.equal(await hold.locator('.hold-fill').evaluate((f) => f.getAnimations().length), 0,
        'the forced 0s duration is what the gate shard hit: no transition runs, so no transitionend can fire');
      await page.waitForSelector('.hold-btn.holding', { state: 'detached', timeout: 5000 });
      await page.mouse.up();
      assert.equal(await eventually(() => exists(id), false), false, 'the press finished without a transitionend');
    } finally {
      await page.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the purge sweep keeps its leading edge`, async () => {
      trashed(`Sweep ${theme}`);
      const { page, hold } = await openPurge(`Sweep ${theme}`, theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        assert.match(await hold.locator('.hold-fill').evaluate((f) => getComputedStyle(f).backgroundImage), /gradient/);
      } finally { await page.close(); }
    });
  }
}
