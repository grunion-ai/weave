import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';
import { SEEDS } from './lib/states.mjs';
import { verdict } from './lib/cutoff.mjs';
import { MIN, PHONE, PLATFORM, fingerprint, measure, rowKey, say, sectionOf, small, surfaces, tally, themesOn } from './lib/touch.mjs';
import { openViews } from './lib/view-pane.mjs';

const FILE = JSON.parse(readFileSync(new URL('./touch-baseline.json', import.meta.url), 'utf8'));
const baseline = sectionOf(FILE);
const IPHONE = phoneProfile()?.page ?? null;
const plan = surfaces();
const seeds = [...new Set(plan.map((p) => p.seed))];

test('every touch baseline entry names a walked state and the Issue rows that track it (Issue #1119)', () => {
  const states = new Set(plan.map((p) => p.state.name));
  for (const platform of Object.keys(FILE).filter((k) => !['_', 'issues'].includes(k))) {
    for (const [fp, n] of Object.entries(FILE[platform])) {
      assert.ok(Number.isInteger(n) && n > 0, `${platform} ${fp}: a count`);
      assert.ok(states.has(fp.split('|')[0]), `${platform} ${fp}: a state the touch probe walks`);
      const rows = FILE.issues[rowKey(fp)];
      assert.ok(Array.isArray(rows) && rows.length && rows.every((r) => Number.isInteger(r) && r > 0), `${platform} ${fp}: names its Issue rows`);
    }
  }
  const used = new Set(Object.keys(FILE).filter((k) => !['_', 'issues'].includes(k)).flatMap((k) => Object.keys(FILE[k]).map(rowKey)));
  assert.deepEqual(Object.keys(FILE.issues).filter((k) => !used.has(k)), [], 'an issues entry no count uses: drop it');
});

const servers = {};
for (const seed of seeds) servers[seed] = await launch(`phone touch targets (${seed})`, SEEDS[seed]);
const s = servers.touch;
test.after(() => { for (const x of Object.values(servers)) x?.server.closeAllConnections(); });

if (s && seeds.every((x) => servers[x])) {
  const engines = [['chromium', s.browser, PHONE]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit', webkit, IPHONE]);

  for (const [engine, browser, profile] of engines) {
    test(`on a phone no control in the state catalog falls under ${MIN}px beyond test/touch-baseline.json (${engine}, Issue #1119)`, async (t) => {
      const findings = [];
      const failed = [];
      for (const entry of plan.filter((p) => themesOn(engine).includes(p.theme))) {
        try {
          const seen = await measure(browser, profile, entry.theme, entry, servers[entry.seed]);
          if (!seen.length) failed.push(`${entry.state.name} (${entry.theme}) offers no control to sweep`);
          for (const c of small(seen)) findings.push({ fp: fingerprint(entry.state.name, c, engine), said: `${entry.state.name} ${entry.theme}: ${say(c)}` });
        } catch (err) {
          failed.push(`${entry.state.name} (${entry.theme}): ${String(err.message).split('\n')[0]}`);
        }
      }
      assert.deepEqual(failed, [], 'a state could not open or offers nothing: its selectors rotted');
      const seen = tally(findings);
      const { added, stale } = verdict(seen, baseline, { cells: null });
      const mine = added.filter((a) => a.fp.endsWith(`|${engine}`));
      for (const a of mine) for (const f of findings.filter((x) => x.fp === a.fp)) t.diagnostic(`new: ${f.said}`);
      for (const x of stale.filter((a) => a.fp.endsWith(`|${engine}`))) t.diagnostic(`stale: ${x.fp} measured ${x.seen} against ${x.baseline}; once that holds across runs, lower it with node scripts/touch-sweep.mjs --lower`);
      t.diagnostic(`${PLATFORM} ${engine} measured: ${JSON.stringify(seen)}`);
      assert.deepEqual(mine, [], `new small targets on ${PLATFORM}: fix them; test/touch-baseline.json never gains a row or a count`);
    });
  }

  const viewSwitcher = {
    hash: `#/table/${s.table}`,
    ready: '#main .wv-grid tbody tr.entity-row',
    act: async (page) => {
      const tools = page.locator('#main .table-tools-btn');
      if (await tools.isVisible()) await tools.click();
      await page.click('#main .crumb-actions .table-view-btn');
    },
  };
  const openSwitcher = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((x) => localStorage.setItem('weave-theme', x), theme);
    await page.goto(`${s.base}/${viewSwitcher.hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(viewSwitcher.ready, { state: 'attached' });
    await viewSwitcher.act(page);
    await page.waitForSelector('.table-view-popover .view-row');
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    return page;
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
    for (const theme of themesOn(engine)) {
      test(`on a phone the view reorder grip is a ${MIN}px target the view name still clears (${engine}, ${theme}, Issue #804)`, async () => {
        const page = await openSwitcher(b, profile, theme);
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
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${s.table}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
      await openViews(page);
      const box = await page.locator('#view-pane .view-strip .view-grip').first().boundingBox();
      assert.ok(box.width < MIN && box.height < MIN, `the desktop grip stays ${Math.round(box.width)}x${Math.round(box.height)}`);
    } finally { await page.close(); }
  });
  test('on a desktop the same chrome keeps its drawn size (Issue #737)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${s.table}`, { waitUntil: 'networkidle' });
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
