import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch, eventually, styleOf } from './lib/browser.mjs';
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

    test(`both strands of the rope sit on the 96px mark (${theme})`, async () => {
      const page = await openWithRope(browser, base, theme);
      const boxes = await page.evaluate(() => {
        const mark = document.querySelector('#page-loader .loader-mark');
        const shown = [...mark.children].find((m) => getComputedStyle(m).display !== 'none');
        const rect = (n) => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
        return { mark: rect(mark), a: rect(shown.querySelector(':scope > .rope-a')), b: rect(shown.querySelector(':scope > .rope-b')) };
      });
      assert.deepEqual(boxes.a, boxes.mark, 'the blue strand is laid out on the mark');
      assert.deepEqual(boxes.b, boxes.mark, 'the flipped strand pivots on the mark, not on a line box');
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

  test('a grid wait that starts before the rope lands picks the rope up when it lands (Issue #960)', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/brand/weave-loader-rope.html', async (route) => { await held; await route.continue(); });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof loading !== 'undefined' && loading.depth === 0 && !!document.querySelector('#main .nav-db, #main .table-wrap, .nav-db'));
    const id = await page.evaluate(() => document.querySelector('.nav-db')?.getAttribute('href'));
    await page.evaluate((h) => { location.hash = h.replace(/^.*#/, '#'); }, id);
    await page.waitForSelector('#main > .table-wrap');
    await page.evaluate(() => { window.__drop = gridHold(); });
    await page.waitForSelector('#main > .grid-loader:not([hidden])');
    const before = await page.evaluate(() => document.querySelectorAll('#main > .grid-loader .rope-a').length);
    assert.equal(before, 0, 'the rope is still held back, so the grid loader starts on the still mark');
    release();
    await page.waitForFunction(() => loading.ready);
    const after = await eventually(() => page.evaluate(() => {
      const node = document.querySelector('#main > .grid-loader');
      return node.querySelectorAll('.rope-a').length > 0
        && node.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length >= 2;
    }), true, { timeout: 5000 });
    assert.equal(after, true, 'the grid loader kept the still mark after the rope landed, so it never moved');
    await page.evaluate(() => window.__drop());
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
  const WAITS = [700, 1100, 1500, 1900, 2300];

  test('a page that finishes mid-cycle leaves on the woven pose within a half second (Issue #392)', async (t) => {
    const seen = [];
    for (const wait of WAITS) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
      await page.addInitScript(() => {
        window.__exit = { out: 0, hidden: 0, phase: null, state: null };
        const arm = () => {
          const host = document.querySelector('#page-loader');
          if (!host) { requestAnimationFrame(arm); return; }
          const rope = () => host.getAnimations({ subtree: true })
            .filter((a) => String(a.animationName || '').startsWith('rope-'));
          new MutationObserver(() => {
            if (!window.__exit.out && host.classList.contains('loader-out')) {
              const [a] = rope();
              window.__exit.out = performance.now();
              window.__exit.phase = a ? (Number(a.currentTime) % 2000) / 2000 : null;
              window.__exit.state = a ? a.playState : null;
            }
            if (!window.__exit.hidden && host.hidden) window.__exit.hidden = performance.now();
          }).observe(host, { attributes: true, attributeFilter: ['class', 'hidden'] });
        };
        arm();
      });
      await page.route('**/api/schema', async (route) => {
        await new Promise((r) => setTimeout(r, wait));
        await route.continue();
      });
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await eventually(() => page.evaluate(() => window.__exit.hidden > 0), true, { timeout: 25000, every: 25 });
      seen.push({ wait, ...await page.evaluate(() => {
        const last = performance.getEntriesByType('resource')
          .filter((e) => e.name.includes('/api/') && e.responseEnd <= window.__exit.hidden)
          .reduce((m, e) => Math.max(m, e.responseEnd), 0);
        return {
          tax: Math.round(window.__exit.hidden - last),
          phase: window.__exit.phase,
          state: window.__exit.state,
        };
      }) });
      await page.close();
    }
    for (const r of seen) {
      t.diagnostic(`${r.wait} ms wait: tax ${r.tax} ms, exit phase ${r.phase}, rope ${r.state}`);
    }
    for (const r of seen) {
      assert.ok(r.tax < 950,
        `a ${r.wait} ms wait held the loader ${r.tax} ms past its last response`);
      assert.notEqual(r.phase, null, `the ${r.wait} ms wait left with no rope animation to read`);
      assert.ok(r.phase >= 0.44 && r.phase <= 0.63,
        `the ${r.wait} ms wait left at phase ${r.phase}: the mark must be woven, never the empty wash`);
      assert.equal(r.state, 'finished',
        `the ${r.wait} ms wait left the rope running: the pose has to be held, not passed through`);
    }
  });

  test('reduced motion keeps the still mark and runs nothing (Issue #394)', async (t) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, reducedMotion: 'reduce' });
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue();
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await eventually(() => page.evaluate(() => {
      const host = document.querySelector('#page-loader');
      return !!host && host.getAttribute('aria-hidden') === 'false'
        && Number(getComputedStyle(host).opacity) === 1;
    }), true, { timeout: 20000, every: 25 });
    const seen = await page.evaluate(() => {
      const host = document.querySelector('#page-loader');
      const box = host.querySelector('.loader-mark').getBoundingClientRect();
      return {
        running: host.getAnimations({ subtree: true })
          .filter((a) => a.playState === 'running').map((a) => String(a.animationName || a.id)),
        rope: host.querySelectorAll('.rope-a').length,
        still: host.querySelectorAll('svg[role="img"]').length,
        size: [box.width, box.height],
      };
    });
    t.diagnostic(`rope spans ${seen.rope}, still marks ${seen.still}, running ${JSON.stringify(seen.running)}`);
    assert.deepEqual(seen.running, [],
      'reduced motion still runs animations inside the loader, so the rope loops');
    assert.equal(seen.rope, 0,
      'the rope was fetched anyway: a parked rope rests on one strand, not the woven mark');
    assert.ok(seen.still >= 1, 'the mark on screen is the still one inlined in index.html');
    assert.deepEqual(seen.size, [96, 96], 'the still mark keeps the 96px box');
    await page.close();
  });

  test('the loader announces the wait once and marks the page busy (Issue #394)', async (t) => {
    const page = await openWithRope(browser, base, 'light');
    const seen = await page.evaluate(async () => {
      const host = document.querySelector('#page-loader');
      const named = () => [...host.querySelectorAll('[aria-label], [role="img"]')]
        .filter((n) => !n.closest('[aria-hidden="true"]')).length;
      const shown = {
        role: host.getAttribute('role'),
        ariaHidden: host.getAttribute('aria-hidden'),
        text: host.querySelector('.loader-status')?.textContent.trim(),
        regions: host.querySelectorAll('.loader-status').length,
        extraNames: named(),
        busy: document.querySelector('#main').getAttribute('aria-busy'),
      };
      hidePageLoader();
      return { shown, busyAfter: document.querySelector('#main').getAttribute('aria-busy') };
    });
    t.diagnostic(JSON.stringify(seen));
    assert.equal(seen.shown.role, 'status', 'the host must be the live region, or nothing is announced');
    assert.equal(seen.shown.ariaHidden, 'false', 'an aria-hidden live region announces nothing');
    assert.equal(seen.shown.text, 'Loading the page', 'the status region carries the text that names the wait');
    assert.equal(seen.shown.regions, 1, 'two status regions would announce the wait twice');
    assert.equal(seen.shown.extraNames, 0,
      'a second accessible name inside the host makes the page announce the wait twice');
    assert.equal(seen.shown.busy, 'true', '#main is busy while the loader covers it');
    assert.equal(seen.busyAfter, null, 'aria-busy outlived the loader, so the page reads as loading forever');
    await page.close();
  });

  test('a long wait names itself, then offers a way out (Issue #393)', async (t) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 14000));
      await route.continue();
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    const caption = page.locator('#page-loader .loader-caption');
    await caption.waitFor({ state: 'visible', timeout: 20000 });
    const atCaption = await page.evaluate(() => Math.round(performance.now()));
    assert.equal((await caption.textContent()).trim(), 'Still loading this page');
    assert.ok(atCaption >= 3500, `the caption appeared at +${atCaption} ms, before the four second mark`);
    assert.equal(await page.locator('#page-loader button').count(), 0,
      'the way out arrived with the caption: ten seconds is the point of offering one');
    const retry = page.locator('#page-loader .loader-retry');
    await retry.waitFor({ state: 'visible', timeout: 20000 });
    const atRetry = await page.evaluate(() => Math.round(performance.now()));
    t.diagnostic(`caption at +${atCaption} ms, retry at +${atRetry} ms`);
    assert.equal((await retry.textContent()).trim(), 'Try again');
    assert.ok(atRetry >= 9500, `the retry appeared at +${atRetry} ms, before the ten second mark`);
    const hidden = await page.evaluate(() => document.querySelector('#page-loader .loader-status').hidden);
    assert.equal(hidden, true, 'the loader says one thing at a time, or the region reads both lines');
    await styleOf(retry, 'pointer-events', 'auto');
    const called = await page.evaluate(async () => {
      window.__routed = 0;
      const real = window.route;
      window.route = () => { window.__routed += 1; return real(); };
      document.querySelector('#page-loader .loader-retry').click();
      return window.__routed;
    });
    assert.equal(called, 1, 'the retry did not hand off to the route');
    await page.close();
  });

  test('a wait that ends before the caption never paints one (Issue #393)', async (t) => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await eventually(() => page.evaluate(() => document.querySelector('#page-loader').hidden), true,
      { timeout: 20000, every: 25 });
    await eventually(() => page.evaluate(() => performance.now() > 6000), true, { timeout: 20000, every: 100 });
    const seen = await page.evaluate(() => ({
      caption: document.querySelectorAll('#page-loader .loader-wait').length,
      status: document.querySelector('#page-loader .loader-status')?.hidden,
    }));
    t.diagnostic(`caption nodes ${seen.caption}, status hidden ${seen.status}`);
    assert.equal(seen.caption, 0, 'the caption outlived its wait and will caption the next one from the start');
    assert.equal(seen.status, false, 'the status text stayed hidden, so the next wait announces nothing');
    await page.close();
  });

  async function coldBoot(browser, base, theme, rope) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    if (rope === 'blocked') await page.route('**/brand/weave-loader-rope.html', (route) => route.abort());
    else await page.route('**/brand/weave-loader-rope.html', async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto(`${base}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!document.documentElement.dataset.bsTheme
      && !!document.querySelector('#page-loader')
      && getComputedStyle(document.querySelector('#page-loader')).animationName !== 'none');
    await eventually(() => page.evaluate(() => Number(getComputedStyle(
      document.querySelector('#page-loader')).opacity)), 1, { timeout: 8000, every: 25 });
    return page;
  }

  function bootMotion(page) {
    return page.evaluate(() => {
      const host = document.querySelector('#page-loader');
      const mark = host.querySelector('.loader-mark');
      const running = mark.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
      const moving = running.filter((a) => a.effect.getKeyframes().some((k) => 'transform' in k));
      return {
        theme: document.documentElement.dataset.bsTheme,
        at: Math.round(performance.now()),
        opacity: Number(getComputedStyle(host).opacity),
        rope: mark.querySelectorAll('.rope-a').length,
        moving: moving.length,
        names: [...new Set(moving.map((a) => a.animationName || '?'))],
        props: [...new Set(moving.flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k))))]
          .filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)),
      };
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`a loader the rope has not reached yet moves on its own (${theme}, Issue #904)`, async (t) => {
      const page = await coldBoot(browser, base, theme, 'slow');
      const seen = await bootMotion(page);
      t.diagnostic(`${seen.theme}: visible at +${seen.at} ms, rope spans ${seen.rope}, moving ${seen.moving} (${seen.names.join(', ') || 'none'})`);
      assert.equal(seen.theme, theme, 'the page must be in the theme under test');
      assert.equal(seen.opacity, 1, 'this case is about the loader the reporter can see');
      assert.equal(seen.rope, 0, 'the rope is still in flight: this is the window Issue #904 reported');
      assert.ok(seen.moving >= 1,
        `the boot mark sat still for the whole visible wait: ${seen.moving} moving animations at +${seen.at} ms`);
      assert.deepEqual(seen.props, ['transform'],
        'the boot mark moves by transform only, like the rope it stands in for');
      await page.close();
    });

    test(`a rope that never arrives leaves the loader moving, not frozen (${theme}, Issue #904)`, async (t) => {
      const page = await coldBoot(browser, base, theme, 'blocked');
      const seen = await bootMotion(page);
      t.diagnostic(`${seen.theme}: visible at +${seen.at} ms, rope spans ${seen.rope}, moving ${seen.moving} (${seen.names.join(', ') || 'none'})`);
      assert.equal(seen.rope, 0, 'the fetch was blocked for this page: nothing may come from it');
      assert.ok(seen.moving >= 1,
        `a failed rope fetch froze the mark with no fallback: ${seen.moving} moving animations at +${seen.at} ms`);
      await page.close();
    });
  }

  test('the rope takes the mark back from the boot animation when it lands (Issue #904)', async (t) => {
    const page = await openWithRope(browser, base, 'light');
    const seen = await page.evaluate(() => {
      const mark = document.querySelector('#page-loader .loader-mark');
      const running = mark.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
      return {
        rope: mark.querySelectorAll('.rope-a').length,
        names: [...new Set(running.map((a) => a.animationName || '?'))],
      };
    });
    t.diagnostic(`rope spans ${seen.rope}, running ${seen.names.join(', ')}`);
    assert.ok(seen.rope >= 1, 'this case is about the loader after the rope has landed');
    assert.deepEqual(seen.names.filter((n) => !n.startsWith('rope-')), [],
      'the boot breathe outlived the rope and now scales the wipe it stood in for');
    await page.close();
  });
}
