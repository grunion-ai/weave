/* The loading rope keeps moving while the page is busy (Issue #390).

   The rope used to animate stroke-dashoffset with SMIL, which Chrome and
   Safari tick on the main thread: boot's JSON parse and a route render froze
   it mid-weave, then it jumped. It now reveals a still mark through a window
   that animates transform only, so the compositor drives it.

   A source grep cannot tell which thread paints a frame; the browser can.
   Chromium's screencast delivers a frame whenever the compositor produces
   one, so a 250 ms busy loop on the main thread must still yield a run of
   distinct frames. The SMIL rope delivered none inside the task. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch } from './lib/browser.mjs';

const s = await launch('page loader', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

async function openWithRope(browser, base, theme) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loading !== 'undefined' && loading.ready && !loading.showTimer
    && loading.depth === 0 && document.querySelector('#page-loader').hidden);
  await page.evaluate(() => showPageLoader());
  return page;
}

if (s) {
  const { base, browser } = s;

  for (const theme of ['light', 'dark']) {
    test(`the rope animates transform only, and nothing in it is SMIL (${theme})`, async () => {
      const page = await openWithRope(browser, base, theme);
      const seen = await page.evaluate(() => {
        const host = document.querySelector('#page-loader');
        const mark = [...host.children].find((m) => getComputedStyle(m).display !== 'none');
        const anims = mark.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
        const box = mark.getBoundingClientRect();
        return {
          theme: document.documentElement.dataset.bsTheme,
          size: [box.width, box.height],
          props: [...new Set(anims.flatMap((a) => a.effect.getKeyframes()
            .flatMap((k) => Object.keys(k).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)))))],
          running: anims.length,
          smil: host.querySelectorAll('animate, animateTransform, animateMotion, set').length,
          dashed: [...host.querySelectorAll('path')].filter((p) => p.getAttribute('stroke-dasharray')).length,
        };
      });
      assert.equal(seen.theme, theme, 'the page must be in the theme under test');
      assert.deepEqual(seen.size, [96, 96], 'the rope keeps its 96px box');
      assert.ok(seen.running >= 2, `the wipe runs (${seen.running} running animations)`);
      assert.deepEqual(seen.props, ['transform'], 'transform is the one property the compositor can own');
      assert.equal(seen.smil, 0, 'no SMIL: Chrome and Safari tick it on the main thread');
      assert.equal(seen.dashed, 0, 'the mark is drawn whole and revealed, never dashed');
      await page.close();
    });
  }

  test('the rope keeps moving through a 250 ms long task',
    { skip: browser.browserType().name() !== 'chromium' && 'the screencast is Chromium CDP' }, async () => {
      const page = await openWithRope(browser, base, 'light');
      // Only the rope may move, or a frame from anything else would pass the test.
      const others = await page.evaluate(() => document.getAnimations()
        .filter((a) => a.playState === 'running' && !document.querySelector('#page-loader').contains(a.effect.target))
        .map((a) => a.animationName || String(a.effect.target?.className)));
      assert.deepEqual(others, [], 'nothing but the loader animates while it is up');
      await page.waitForTimeout(300);
      const cdp = await page.context().newCDPSession(page);
      const frames = [];
      cdp.on('Page.screencastFrame', (f) => {
        frames.push({ t: f.metadata.timestamp * 1000, hash: createHash('sha1').update(f.data).digest('hex') });
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'png' });
      await page.waitForTimeout(200);
      // The rope rests for 340 ms mid-cycle, so start the task where it draws
      // in: phase 0.05 of the cycle, committed to the compositor by two frames.
      const task = await page.evaluate(async () => {
        for (const a of document.querySelector('#page-loader').getAnimations({ subtree: true })) a.currentTime = 100;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return new Promise((resolve) => setTimeout(() => {
          const t0 = performance.timeOrigin + performance.now();
          const end = performance.now() + 250;
          while (performance.now() < end) { /* the long task */ }
          resolve({ t0, t1: performance.timeOrigin + performance.now() });
        }, 0));
      });
      await page.waitForTimeout(200);
      await cdp.send('Page.stopScreencast');
      const inside = frames.filter((f) => f.t > task.t0 + 10 && f.t < task.t1 - 10);
      const distinct = new Set(inside.map((f) => f.hash)).size;
      assert.ok(distinct >= 5,
        `the rope froze: ${inside.length} frames (${distinct} distinct) inside a ${Math.round(task.t1 - task.t0)} ms task`);
      await page.close();
    });
}
