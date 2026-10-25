import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';
import { ROUTES, SEEDS, held, readyOf, rootsOf, walked } from './lib/states.mjs';
import { openViews } from './lib/view-pane.mjs';

const MIN = 44;
const STEP = 0.5;
const SPAN = MIN - 1;
const IPHONE = phoneProfile()?.page ?? null;

const SWEEP = (roots) => {
  const SEL = 'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea, :is(tbody tr.entity-row, .wv-list .list-row)';
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
  const measure = async (b, profile, theme, surface) => {
    const page = await open(b, profile, theme, surface);
    try {
      const seen = await page.evaluate(SWEEP, surface.roots);
      const small = seen.filter((c) => c.left + c.right < SPAN || c.up + c.down < SPAN);
      const offenders = small.map((c) => (c.over
        ? `${c.label} is covered by ${c.over}`
        : `${c.label} taps ${c.left + c.right}x${c.up + c.down} of the ${MIN}px minimum`));
      return { seen, offenders };
    } finally { await page.close(); }
  };

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
      test(`on a phone the ${surface.name} still misses the ${MIN}px hit areas Issue #${hold.join(', #')} tracks, held out of the gate (${engine}, ${theme}, Issue #1119)`, async (t) => {
        const { seen, offenders } = await measure(b, profile, theme, surface);
        t.diagnostic(`held: ${offenders.length} of ${seen.length} controls on the ${surface.name} miss ${MIN}px:\n${offenders.join('\n')}`);
        assert.ok(offenders.length, `every control on the ${surface.name} now keeps ${MIN}px: drop its touch hold in test/lib/states.mjs so the gate walks it`);
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
