import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, probe, seed, settle } from './lib/cutoff.mjs';
import { ROUTES } from './lib/states.mjs';

const s = await launch('toggle word wraps', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const places = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport }, route: 'sink-board', scope: '.wv-board .tile-field > dd', box: 'dd' },
    phone: { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport }, route: 'sink-row', scope: '#dock .entity-values .fieldrow', box: '.fieldrow' },
  };
  const measure = (words, box) => words.evaluateAll((ws, sel) => ws.map((w) => {
    const r = w.getBoundingClientRect();
    const host = w.closest(sel).getBoundingClientRect();
    return { text: w.textContent, cut: w.scrollWidth - w.clientWidth, over: Math.round((r.right - host.right) * 10) / 10 };
  }), box);

  for (const [cell, p] of Object.entries(places)) {
    for (const theme of ['light', 'dark']) {
      test(`${cell} ${theme}: a toggle label prints in full beside its switch on the ${p.route} (Issue #1156)`, async (t) => {
        if (!p.browser) return t.skip(`${CELLS[cell].engine} cannot launch here`);
        const page = await p.browser.newPage(p.page);
        try {
          await page.goto(ROUTES[p.route].url(s, cell), { waitUntil: 'networkidle' });
          await page.waitForSelector(ROUTES[p.route].ready(cell));
          await page.evaluate((th) => document.documentElement.setAttribute('data-bs-theme', th), theme);
          await settle(page);
          const words = page.locator(`${p.scope} .wv-toggle-word`);
          const got = await measure(words, p.box);
          assert.ok(got.some((g) => g.text === 'Published to every customer'), `the kitchen sink's on label is on the ${p.route}: ${JSON.stringify(got)}`);
          for (const g of got) {
            assert.ok(g.cut <= 1, `"${g.text}" is cut by ${g.cut}px`);
            assert.ok(g.over <= 0.5, `"${g.text}" runs ${g.over}px past its ${p.box}`);
          }
          const found = (await page.evaluate(probe, null)).filter((f) => String(f.selector).includes('wv-toggle-word'));
          assert.deepEqual(found.map((f) => `${f.kind}|${f.selector}`), [], 'the cut-off probe sees no toggle word');
        } finally { await page.close(); }
      });
    }
  }
}
