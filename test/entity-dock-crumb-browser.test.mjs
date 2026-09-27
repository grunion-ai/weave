/* The table's crumb line with an entity docked (Issue #437). Docking an
   entity shrinks the table panel to 560–650 px at 1440, and the toolbar
   (Search, view, density, Fields, Filters, ⋮) kept its width while the
   crumb trail was squeezed to one word per line and drawn underneath the
   controls. The trail stays one line, truncating with an ellipsis, and the
   toolbar drops to its own row below it when the two do not fit side by
   side: nothing draws on top of the crumb. Checked with the nav open, the
   nav collapsed, and the table pressed to its 320 px floor.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, row;
const s = await launch('entity dock crumb', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Sessions' });
  weave.addField(sessions, { name: 'Started', type: 'date' });
  row = weave.createEntity(sessions, { name: 'Overnight fixer run', values: { Started: '2026-09-27' } });
});
if (s) {
  const { base, browser } = s;
  async function openDocked({ collapsed = false, pin = 0 } = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(({ collapsed, pin }) => {
      localStorage.setItem('weave-nav-collapsed', collapsed ? '1' : '');
      if (pin) localStorage.setItem('wv-dock-width', String(pin));
    }, { collapsed, pin });
    await page.goto(`${base}/#/table/${sessions.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${row.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    await page.waitForTimeout(100);
    return page;
  }
  const measure = (page) => page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const path = document.querySelector('#main .view-header .crumb-path');
    const actions = document.querySelector('#main .view-header .crumb-actions');
    const controls = [...actions.children].filter((c) => c.getClientRects().length).map((c) => ({ name: c.className || c.tagName, ...box(c) }));
    const cs = getComputedStyle(path);
    return {
      main: box(document.querySelector('#main')),
      path: box(path),
      lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
      controls,
    };
  });
  const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

  for (const [label, opts] of [
    ['at 1440 with the nav open', {}],
    ['at 1440 with the nav collapsed', { collapsed: true }],
    ['with the table at its 320 px floor', { pin: 2000 }],
  ]) {
    test(`the docked table's crumb holds one line clear of the toolbar ${label}`, async () => {
      const page = await openDocked(opts);
      const m = await measure(page);
      assert.ok(m.main.w < 700, `the dock squeezes the table panel: ${m.main.w}px`);
      assert.ok(m.path.h <= m.lineHeight * 1.5, `crumb is one line: ${m.path.h}px tall at line-height ${m.lineHeight}px`);
      assert.ok(m.path.w > 40, `crumb keeps visible room: ${m.path.w}px`);
      for (const c of m.controls) {
        assert.ok(!overlaps(m.path, c), `crumb ${JSON.stringify(m.path)} overlaps toolbar control ${c.name} ${JSON.stringify(c)}`);
      }
      await page.close();
    });
  }
}
