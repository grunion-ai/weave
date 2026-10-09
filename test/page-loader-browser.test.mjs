import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch, eventually } from './lib/browser.mjs';
import { APP } from './lib/source.mjs';
const LOADER_SHOW_AFTER_MS = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);

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
    { skip: browser.browserType().name() !== 'chromium' && 'the screencast is Chromium CDP' }, async (t) => {
      const page = await openWithRope(browser, base, 'light');
      const others = await page.evaluate(() => document.getAnimations()
        .filter((a) => a.playState === 'running' && !document.querySelector('#page-loader').contains(a.effect.target))
        .map((a) => a.animationName || String(a.effect.target?.className)));
      assert.deepEqual(others, [], 'nothing but the loader animates while it is up');
      await page.waitForFunction(() => {
        const anims = document.querySelector('#page-loader').getAnimations({ subtree: true });
        return anims.length > 0 && anims.every((a) => a.playState === 'running' && a.currentTime > 0);
      });
      const cdp = await page.context().newCDPSession(page);
      const frames = [];
      cdp.on('Page.screencastFrame', (f) => {
        frames.push({ t: f.metadata.timestamp * 1000, hash: createHash('sha1').update(f.data).digest('hex') });
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 320, maxHeight: 240 });
      await eventually(() => frames.length > 0, true);
      const task = await page.evaluate(async () => {
        for (const a of document.querySelector('#page-loader').getAnimations({ subtree: true })) a.currentTime = 100;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return new Promise((resolve) => setTimeout(() => {
          const t0 = performance.timeOrigin + performance.now();
          const end = performance.now() + 250;
          while (performance.now() < end) {}
          resolve({ t0, t1: performance.timeOrigin + performance.now() });
        }, 0));
      });
      await eventually(() => frames.some((f) => f.t > task.t1), true);
      await cdp.send('Page.stopScreencast');
      const span = task.t1 - task.t0, lateFrom = task.t0 + 0.6 * span;
      const inside = frames.filter((f) => f.t > task.t0 && f.t < task.t1);
      const before = [...frames].reverse().find((f) => f.t <= lateFrom);
      const late = inside.filter((f) => f.t > lateFrom);
      const moved = late.filter((f, i) => f.hash !== (i ? late[i - 1] : before)?.hash).length;
      const seen = `${inside.length} frames in a ${Math.round(span)} ms task, ${late.length} in its last 40% (${moved} changed), ` +
        `last at +${inside.length ? Math.round(inside.at(-1).t - task.t0) : 'none'} ms`;
      t.diagnostic(seen);
      assert.ok(moved >= 1, `the rope stopped during the task: ${seen}`);
      await page.close();
    });

  test('a boot whose rope never arrives still shows the brand mark past the threshold (Issue #391)', async (t) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/brand/weave-loader-rope.html', (route) => route.abort());
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.addInitScript(() => {
      window.__shownAt = null;
      document.addEventListener('animationstart', (e) => {
        if (e.target?.id === 'page-loader' && window.__shownAt === null) window.__shownAt = performance.now();
      }, true);
    });
    await page.goto(`${base}/`, { waitUntil: 'commit' });
    const shown = await eventually(() => page.evaluate(() => window.__shownAt !== null), true, { timeout: 15000 });
    assert.equal(shown, true, 'the loader never appeared, so the shell sat bare for the whole wait');
    const opaque = await eventually(() => page.evaluate(() => Number(getComputedStyle(
      document.querySelector('#page-loader')).opacity)), 1, { timeout: 5000, every: 25 });
    assert.equal(opaque, 1, 'the loader faded in but never reached full opacity');
    const seen = await page.evaluate(() => {
      const host = document.querySelector('#page-loader');
      const mark = host.querySelector('.mark-light, .mark-dark');
      const box = mark.getBoundingClientRect();
      return {
        at: Math.round(window.__shownAt),
        size: [box.width, box.height],
        still: host.querySelectorAll('svg[role="img"]').length,
        rope: host.querySelectorAll('.rope-a').length,
        ready: typeof loading !== 'undefined' && loading.ready,
      };
    });
    t.diagnostic(`shown at +${seen.at} ms, still marks ${seen.still}, rope spans ${seen.rope}`);
    assert.ok(seen.at >= 400, `the gate let the loader through at +${seen.at} ms, before the ${LOADER_SHOW_AFTER_MS} ms threshold`);
    assert.deepEqual(seen.size, [96, 96], 'the boot mark keeps the 96px box');
    assert.equal(seen.rope, 0, 'the fetch was blocked for this page: nothing may come from it');
    assert.equal(seen.ready, false, 'loading.ready still tracks the fetched rope only');
    assert.ok(seen.still >= 1, 'the mark on screen is the one inlined in index.html');
    await page.close();
  });

  test('a show after boot is not held back by the boot gate (Issue #391)', async (t) => {
    const page = await openWithRope(browser, base, 'light');
    const lag = await page.evaluate(async () => {
      const host = document.querySelector('#page-loader');
      const t0 = performance.now();
      while (Number(getComputedStyle(host).opacity) < 1 && performance.now() - t0 < 2000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      return Math.round(performance.now() - t0);
    });
    t.diagnostic(`opaque ${lag} ms after the show`);
    assert.ok(lag < 300,
      `the show waited ${lag} ms: the one-shot boot delay replayed, so every wait reads late`);
    await page.close();
  });
}
