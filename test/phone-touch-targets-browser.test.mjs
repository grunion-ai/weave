import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';
import { ROUTES, SEEDS, STATES, held, plan, readyOf, rootsOf, walked } from './lib/states.mjs';
import { openViews } from './lib/view-pane.mjs';

const MIN = 44;
const STEP = 0.5;
const SPAN = MIN - 1;
const IPHONE = phoneProfile()?.page ?? null;
const HELD = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'touch-held.json'), 'utf8')).offenders;
const heldKey = (surface, theme) => `${surface} | ${theme}`;
const fingerprint = (c) => (c.over
  ? `${c.label} is covered by ${c.over}`
  : `${c.label} misses the ${MIN}px minimum ${[c.left + c.right < SPAN ? 'across' : null, c.up + c.down < SPAN ? 'down' : null].filter(Boolean).join(' and ')}`);
const PLANT = (root) => {
  const b = document.createElement('button');
  b.textContent = 'planted';
  b.style.cssText = 'position:fixed;left:50%;top:50%;width:12px;height:12px;min-width:0;min-height:0;padding:0;margin:0;font-size:4px;line-height:1;overflow:hidden;z-index:2147483647';
  (document.querySelector(root) ?? document.body).appendChild(b);
};

const KEPT_REACH = (sel) => {
  const owns = (n, hit) => !!hit && (hit === n || n.contains(hit));
  const reach = (n, cx, cy, dx, dy) => {
    let far = 0;
    for (let d = 0.5; d <= 22; d += 0.5) {
      const x = cx + dx * d, y = cy + dy * d;
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return 22;
      if (!owns(n, document.elementFromPoint(x, y))) return far;
      far = d;
    }
    return far;
  };
  const out = [];
  for (const n of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(n);
    if (!n.getClientRects().length || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    out.push({
      w: Math.round(r.width), h: Math.round(r.height),
      x: reach(n, cx, cy, -1, 0) + reach(n, cx, cy, 1, 0),
      y: reach(n, cx, cy, 0, -1) + reach(n, cx, cy, 0, 1),
    });
  }
  return out;
};
const SWEEP = (roots) => {
  const SEL = 'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea, .text-dressed, tbody tr.entity-row';
  const tops = roots.flatMap((r) => [...document.querySelectorAll(r)]);
  const inRoot = (n) => tops.some((t) => t.contains(n));
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || !n.getClientRects().length) return false;
    const shut = n.closest('details:not([open])');
    if (n.disabled || (shut && n !== shut.querySelector(':scope > summary'))) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const label = (n) => {
    const cls = [...n.classList].slice(0, 2).join('.');
    const name = (n.getAttribute('aria-label') || n.title || n.dataset.field || (n.textContent || '').trim().slice(0, 32) || '').replace(/\s+/g, ' ');
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${name}"`;
  };
  const owns = (n, hit) => !!hit && (hit === n || n.contains(hit));
  const parked = (n, r) => {
    for (let p = n.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/auto|scroll/.test(cs.overflowY) && !/auto|scroll/.test(cs.overflowX)) continue;
      const b = p.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) return true;
    }
    return false;
  };
  const overlay = (n, hit) => {
    for (let p = hit; p && p !== document.documentElement; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position)) return !p.contains(n);
    }
    return false;
  };
  const reach = (n, cx, cy, dx, dy) => {
    let far = 0;
    for (let d = 0.5; d <= 22; d += 0.5) {
      const x = cx + dx * d, y = cy + dy * d;
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return 22;
      const hit = document.elementFromPoint(x, y);
      if (!owns(n, hit)) return overlay(n, hit) ? 22 : far;
      far = d;
    }
    return far;
  };
  const found = tops.flatMap((t) => [...t.querySelectorAll(SEL)]).filter(shown);
  const candidates = new Set(found);
  const out = [];
  for (const n of found) {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
    if (parked(n, r)) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!owns(n, hit)) {
      if (!hit || !inRoot(hit) || overlay(n, hit)) continue;
      let up = hit;
      while (up && !candidates.has(up)) up = up.parentElement;
      if (up && up.contains(n)) continue;
      out.push({ label: label(n), left: 0, right: 0, up: 0, down: 0, over: label(hit) });
      continue;
    }
    out.push({
      label: label(n),
      left: reach(n, cx, cy, -1, 0), right: reach(n, cx, cy, 1, 0),
      up: reach(n, cx, cy, 0, -1), down: reach(n, cx, cy, 0, 1),
    });
  }
  return out;
};

const s = await launch('phone touch targets', SEEDS.touch);

if (s) {
  const { base, browser, table } = s;
  const surfaceOf = (state) => ({ name: state.name, url: ROUTES[state.route].url(s, 'phone'), ready: readyOf(state, 'phone'), roots: rootsOf(state), act: state.act });
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);

  const open = async (b, profile, theme, surface) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(surface.url ?? `${base}/${surface.hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(surface.ready ?? surface.roots[0], { state: 'attached' });
    if (surface.act) {
      await surface.act(page);
      await page.waitForSelector(surface.roots[0]);
    }
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    return page;
  };

  const themesOn = (engine) => (engine.startsWith('chromium') ? ['light', 'dark'] : ['light']);
  const measure = async (b, profile, theme, surface, { plant = null } = {}) => {
    const page = await open(b, profile, theme, surface);
    try {
      if (plant) await page.evaluate(plant, surface.roots[0]);
      const seen = await page.evaluate(SWEEP, surface.roots);
      const small = seen.filter((c) => c.left + c.right < SPAN || c.up + c.down < SPAN);
      const offenders = small.map((c) => (c.over
        ? `${c.label} is covered by ${c.over}`
        : `${c.label} taps ${c.left + c.right}x${c.up + c.down} of the ${MIN}px minimum`));
      const fingerprints = small.map(fingerprint);
      return { seen, offenders, fingerprints };
    } finally { await page.close(); }
  };

  test('every held touch state has a test/touch-held.json entry naming the Issue its hold names, and no entry outlives its hold (Issue #1450)', () => {
    const holds = new Map(held('touch').map((p) => [heldKey(surfaceOf(p.state).name, p.theme), p.hold]));
    for (const [key, hold] of holds) {
      const row = HELD[key];
      assert.ok(row, `${key} is held in test/lib/states.mjs with no entry in test/touch-held.json`);
      assert.ok(hold.includes(row.issue), `${key}: test/touch-held.json names Issue #${row.issue}, the hold names #${hold.join(', #')}`);
      assert.ok(Array.isArray(row.offenders) && row.offenders.length, `${key}: a held state records at least one offender`);
      for (const o of row.offenders) {
        assert.doesNotMatch(o, /\d+(\.\d+)?x\d+(\.\d+)?/, `${key}: "${o}" records a measurement. A fingerprint names the control and the axis that misses, never its pixels: the same control swept 32x43.5 on macOS and 33x43.5 on the Linux runner, and a pinned measurement turned the gate red for one pixel of font metrics (Issue #1450).`);
      }
    }
    for (const key of Object.keys(HELD)) {
      assert.ok(holds.has(key), `${key} is recorded in test/touch-held.json but nothing holds it any more: drop the entry`);
    }
  });

  for (const [engine, b, profile] of engines) {
    for (const { state, theme } of walked('touch').filter((p) => themesOn(engine).includes(p.theme))) {
      const surface = surfaceOf(state);
      test(`on a phone every control on the ${surface.name} keeps a ${MIN}px hit area (${engine}, ${theme}, Issue #737)`, async () => {
        const { seen, offenders } = await measure(b, profile, theme, surface);
        assert.ok(seen.length >= 1, `the ${surface.name} offers controls to sweep`);
        assert.deepEqual(offenders, [], `${offenders.length} of ${seen.length} controls on the ${surface.name} miss a ${MIN}px hit area:\n${offenders.join('\n')}`);
      });
    }
    for (const { state, theme, hold } of held('touch').filter((p) => themesOn(engine).includes(p.theme))) {
      const surface = surfaceOf(state);
      const ledger = HELD[heldKey(surface.name, theme)];
      test(`on a phone the ${surface.name} misses exactly the ${MIN}px hit areas test/touch-held.json records for Issue #${hold.join(', #')} (${engine}, ${theme}, Issues #1119, #1450)`, async (t) => {
        const { seen, offenders, fingerprints } = await measure(b, profile, theme, surface);
        t.diagnostic(`held: ${offenders.length} of ${seen.length} controls on the ${surface.name} miss ${MIN}px:\n${offenders.join('\n')}`);
        assert.ok(ledger, `${heldKey(surface.name, theme)} is held but test/touch-held.json records no offenders for it`);
        assert.ok(fingerprints.length, `every control on the ${surface.name} now keeps ${MIN}px: drop its touch hold in test/lib/states.mjs and its test/touch-held.json entry so the gate walks it`);
        assert.deepEqual(fingerprints.slice().sort(), ledger.offenders.slice().sort(),
          `the held offenders on the ${surface.name} moved: test/touch-held.json only shrinks, so a new one is a regression and a fixed one leaves the file in the same change. Measured:\n${offenders.join('\n')}`);
      });

      test(`on a phone one more undersized control on the held ${surface.name} fails the gate (${engine}, ${theme}, Issue #1450)`, async () => {
        const { offenders, fingerprints } = await measure(b, profile, theme, surface, { plant: PLANT });
        const planted = fingerprints.filter((o) => o.includes('planted'));
        assert.equal(planted.length, 1, `the sweep sees the planted control; it saw ${JSON.stringify(offenders)}`);
        assert.notDeepEqual(fingerprints.slice().sort(), ledger.offenders.slice().sort(),
          'a grown offender list has to differ from test/touch-held.json, which is what the held assertion now compares');
        assert.ok(fingerprints.length > ledger.offenders.length,
          `the count ceiling is exceeded: ${fingerprints.length} offenders against the ${ledger.offenders.length} recorded, and a bare offenders.length check passed both`);
      });
    }
    for (const { state, theme } of plan('touch').filter((p) => themesOn(engine).includes(p.theme))) {
      const surface = surfaceOf(state);
      for (const kept of state.kept?.touch ?? []) {
        test(`on a phone every ${kept.sel} on the ${surface.name} keeps a ${MIN}px hit area (${engine}, ${theme}, Issue #${kept.issue})`, async () => {
          const page = await open(b, profile, theme, surface);
          try {
            const hits = await page.evaluate(KEPT_REACH, kept.sel);
            assert.ok(hits.length, `the ${surface.name} draws ${kept.sel} to measure`);
            const missed = hits.filter((h) => h.x < SPAN || h.y < SPAN);
            assert.deepEqual(missed, [], `${missed.length} of ${hits.length} ${kept.sel} miss a ${MIN}px hit area: ${missed.map((h) => `${h.w}x${h.h} drawn, ${h.x}x${h.y} reached`).join('; ')}`);
          } finally { await page.close(); }
        });
      }
    }
  }

  const PARKED_FIXTURE = () => {
    const small = (label, top) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'parked-fixture-btn';
      b.setAttribute('aria-label', label);
      b.style.cssText = `position:absolute;left:0;top:${top}px;width:20px;height:20px;`;
      return b;
    };
    const scroller = document.createElement('div');
    scroller.id = 'parked-fixture';
    scroller.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:60px;overflow-y:auto;background:#fff;z-index:9999;';
    const tall = document.createElement('div');
    tall.style.cssText = 'position:relative;height:400px;';
    tall.append(small('a button in view', 10), small('a button straddling the fold', 50), small('a button parked below the fold', 300));
    scroller.append(tall);
    document.body.append(scroller);
  };

  for (const [engine, b, profile] of engines) {
    test(`a control a scroller has clipped is not a missed tap target, and the one in view still is (${engine}, Issue #1187)`, async () => {
      const page = await open(b, profile, 'light', { ...surfaceOf(STATES.find((st) => st.name === 'row page')), roots: ['#parked-fixture'] });
      try {
        await page.evaluate(PARKED_FIXTURE);
        const seen = await page.evaluate(SWEEP, ['#parked-fixture']);
        const labels = seen.map((c) => c.label);
        assert.deepEqual(labels, ['button.parked-fixture-btn "a button in view"'],
          `the sweep reads the button the scroller shows whole and walks past the clipped and parked ones, got ${JSON.stringify(labels)}`);
        const small = seen.filter((c) => c.left + c.right < SPAN || c.up + c.down < SPAN);
        assert.equal(small.length, 1, 'the 20px button the scroller shows whole is still reported as under the minimum');
      } finally { await page.close(); }
    });
  }

  const FOLD_BOXES = () => [...document.querySelectorAll('.wv-board :is(.board-lane-head, .board-group-head) .list-fold')].map((n) => {
    const r = n.getBoundingClientRect();
    return { label: n.getAttribute('aria-label') || 'a board fold', width: Math.round(r.width), height: Math.round(r.height) };
  });
  for (const [engine, b, profile] of engines) {
    for (const state of STATES.filter((st) => st.layout === 'board' && st.open === 'rest')) {
      for (const theme of themesOn(engine)) {
        test(`on a phone every fold on the ${state.name} draws its own ${MIN}px box (${engine}, ${theme}, Issue #1217)`, async () => {
          const page = await open(b, profile, theme, surfaceOf(state));
          try {
            const folds = await page.evaluate(FOLD_BOXES);
            assert.ok(folds.length >= 1, `the ${state.name} draws a fold per head, got ${folds.length}`);
            assert.deepEqual(folds.filter((f) => f.width < MIN || f.height < MIN)
              .map((f) => `${f.label} draws ${f.width}x${f.height} of the ${MIN}px minimum`), [],
            'each board head fold is a real box, so the board scroller cannot clip it the way it clips pseudo slop');
          } finally { await page.close(); }
        });
      }
    }
  }

  const sinkRow = surfaceOf(walked('touch').concat(held('touch')).find((p) => p.state.name === 'sink-row').state);
  const avatars = { ...sinkRow, name: 'avatar controls on the phone record page', roots: ['#dock .av-control'] };
  for (const [engine, b, profile] of engines) {
    for (const theme of themesOn(engine)) {
      test(`on a phone the avatar Change photo button keeps a ${MIN}px hit area (${engine}, ${theme}, Issue #1167)`, async () => {
        const { seen, offenders } = await measure(b, profile, theme, avatars);
        assert.deepEqual(seen.map((c) => c.label), ['button.av-pick "Change photo"'], 'the record head offers one avatar control, its Change photo button');
        assert.deepEqual(offenders, [], `${offenders.length} of ${seen.length} avatar controls miss a ${MIN}px hit area:\n${offenders.join('\n')}`);
      });
    }
  }

  const REACH = () => {
    const menu = document.querySelector('#sidebar').getBoundingClientRect();
    const clips = (n) => {
      const out = [];
      for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowY !== 'visible') out.push(p);
      }
      return out;
    };
    const label = (n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const links = [...document.querySelectorAll('#nav a.nav-space, #nav .nav-db')].filter((n) => n.getClientRects().length);
    const hidden = [];
    for (const n of links) {
      const r = n.getBoundingClientRect();
      const cut = clips(n).find((p) => { const c = p.getBoundingClientRect(); return r.top < c.top || r.bottom > c.bottom; });
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.top < 0 || r.bottom > innerHeight) hidden.push(`${label(n)} sits at ${Math.round(r.top)}-${Math.round(r.bottom)} past the ${innerHeight}px screen`);
      else if (cut) hidden.push(`${label(n)} is clipped by ${cut.tagName.toLowerCase()}#${cut.id || cut.className} (${Math.round(cut.getBoundingClientRect().height)}px tall)`);
      else if (!hit || !(hit === n || n.contains(hit))) hidden.push(`${label(n)} answers a tap with ${hit ? hit.className || hit.tagName : 'nothing'}`);
    }
    const list = links[0] && clips(links[0]).find((p) => p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY));
    return { list: list ? Math.round(list.clientHeight) : Math.round(menu.height), spaces: links.filter((n) => n.matches('a.nav-space')).length, links: links.length, menu: Math.round(menu.height), hidden };
  };
  const phoneMenu = {
    name: 'phone menu',
    url: ROUTES.table.url(s, 'phone'),
    ready: '#main .nav-menu',
    roots: ['#sidebar'],
    act: (page) => page.click('#main .nav-menu'),
  };
  for (const [engine, b, profile] of engines) {
    {
      const theme = 'light';
      test(`on a phone every space and table in the menu sits in view and takes a tap (${engine}, ${theme}, Issue #1164)`, async () => {
        const page = await open(b, profile, theme, phoneMenu);
        try {
          const seen = await page.evaluate(REACH);
          assert.ok(seen.spaces >= 2, `the touch seed draws at least two spaces in the menu, got ${seen.spaces}`);
          assert.ok(seen.list * 2 >= seen.menu, `the space list keeps at least half of the ${seen.menu}px menu, got ${seen.list}px`);
          assert.deepEqual(seen.hidden, [], `${seen.hidden.length} of ${seen.links} menu links are out of reach in the ${seen.menu}px menu:\n${seen.hidden.join('\n')}`);
          const trash = page.locator('#sidebar .nav-system a[href="#/trash"]');
          await trash.scrollIntoViewIfNeeded();
          assert.equal(await trash.evaluate((n) => {
            const r = n.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!hit && (hit === n || n.contains(hit));
          }), true, 'the sticky identity panel leaves Trash reachable');
          await trash.click();
          await page.waitForFunction(() => location.hash === '#/trash' && !document.querySelector('#app').classList.contains('nav-peek'));

        } finally { await page.close(); }
      });
    }
  }

  const viewSwitcher = {
    name: 'views popover',
    hash: `#/table/${table}`,
    ready: '#main .wv-grid tbody tr.entity-row',
    roots: ['.table-view-popover .view-row'],
    act: async (page) => {
      const tools = page.locator('#main .table-tools-btn');
      if (await tools.isVisible()) await tools.click();
      await page.click('#main .crumb-actions .table-view-btn');
    },
  };
  const GRIPS = (min) => {
    const out = [];
    const pop = document.querySelector('.table-view-popover');
    const popBox = pop.getBoundingClientRect();
    const inset = 2;
    for (const grip of pop.querySelectorAll('.view-grip')) {
      const r = grip.getBoundingClientRect();
      const row = grip.closest('.view-row');
      const name = row.querySelector('.view-name');
      const nameBox = name.getBoundingClientRect();
      const owns = (node, x, y) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === node || node.contains(hit)); };
      const corners = [[r.left + inset, r.top + inset], [r.right - inset, r.top + inset],
        [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]];
      out.push({
        label: grip.getAttribute('aria-label') || 'a view grip',
        width: Math.round(r.width),
        height: Math.round(r.height),
        deaf: corners.filter(([x, y]) => !owns(grip, x, y)).length,
        spill: Math.round(Math.max(popBox.left - r.left, r.right - popBox.right)),
        nameTaps: owns(name, nameBox.left + nameBox.width / 2, nameBox.top + nameBox.height / 2),
        popWidth: Math.round(popBox.width),
        min,
      });
    }
    return out;
  };
  for (const [engine, b, profile] of engines) {
    const themes = engine.startsWith('chromium') ? ['light', 'dark'] : ['light'];
    for (const theme of themes) {
      test(`on a phone the view reorder grip is a ${MIN}px target the view name still clears (${engine}, ${theme}, Issue #804)`, async () => {
        const page = await open(b, profile, theme, viewSwitcher);
        try {
          const grips = await page.evaluate(GRIPS, MIN);
          assert.ok(grips.length >= 1, `the view switcher draws a grip per view, got ${grips.length}`);
          assert.deepEqual(grips.filter((g) => g.width < MIN || g.height < MIN)
            .map((g) => `${g.label} draws ${g.width}x${g.height} of the ${MIN}px minimum`), [],
          'every view grip is at least the minimum target');
          assert.deepEqual(grips.filter((g) => g.deaf).map((g) => `${g.label} has ${g.deaf} of 4 corners answering to something else`), [],
            'the whole grip box answers to the grip, so the target is real and not covered');
          assert.deepEqual(grips.filter((g) => g.spill > 0).map((g) => `${g.label} spills ${g.spill}px past the popover`), [],
            'the bigger target stays inside the popover');
          assert.deepEqual(grips.filter((g) => !g.nameTaps).map((g) => `${g.label} covers the view name`), [],
            'the view name still takes the tap that opens the view');
          assert.ok(grips[0].popWidth <= 340, `the popover keeps its width, got ${grips[0].popWidth}px`);
        } finally { await page.close(); }
      });
    }
  }
  test('on a desktop the view reorder grip keeps its drawn size (Issue #804)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${table}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
      await openViews(page);
      const box = await page.locator('#view-pane .view-strip .view-grip').first().boundingBox();
      assert.ok(box.width < MIN && box.height < MIN, `the desktop grip stays ${Math.round(box.width)}x${Math.round(box.height)}`);
    } finally { await page.close(); }
  });
  test('on a desktop the same chrome keeps its drawn size (Issue #737)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${table}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
      const h = await page.evaluate(() => {
        const box = (q) => { const n = document.querySelector(q); return n ? Math.round(n.getBoundingClientRect().height) : null; };
        return { title: box('#main .view-title'), crumb: box('#main .crumb-item') };
      });
      assert.ok(h.title !== null && h.title < MIN, `the desktop title stays ${h.title}px`);
      assert.ok(h.crumb !== null && h.crumb < MIN, `the desktop crumb stays ${h.crumb}px`);
    } finally { await page.close(); }
  });
}
