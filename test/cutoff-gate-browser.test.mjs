import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, PLATFORM, fingerprint, probe, sectionOf, seed, sweepCell, tally, verdict } from './lib/cutoff.mjs';

const baseline = sectionOf(JSON.parse(readFileSync(new URL('./cutoff-baseline.json', import.meta.url), 'utf8')));

const s = await launch('cutoff ratchet', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };

  test('long URL and date text remains reachable by scrolling (Issue #897)', async () => {
    const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
    try {
      await page.goto(`${s.base}/#/table/${s.tasks.id}`, { waitUntil: 'networkidle' });
      for (const selector of ['.url-link', '.range-cell']) {
        const cell = page.locator(`.wv-grid tbody ${selector}`).first();
        const result = await cell.evaluate((node) => {
          const text = () => node.querySelector('input')?.value || node.textContent;
          const before = text();
          node.scrollLeft = node.scrollWidth;
          return { before, after: text(), left: node.scrollLeft, end: node.scrollWidth - node.clientWidth, overflow: getComputedStyle(node).overflowX };
        });
        assert.equal(result.overflow, 'auto');
        if (selector === '.url-link') assert.ok(result.end > 0);
        else assert.ok(result.end >= 0);
        assert.ok(Math.abs(result.left - result.end) <= 1);
        assert.equal(result.after, result.before);
      }
    } finally { await page.close(); }
  });

  test('Issue #937: text parked below the fold is not cut-off text anyone can see', async () => {
    const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
    try {
      await page.goto(`${s.base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main');
      await page.evaluate(() => {
        const line = (top) => {
          const span = document.createElement('span');
          span.className = 'cutoff-fixture-line';
          span.style.cssText = `position:absolute;left:0;top:${top}px;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
          span.textContent = 'a label far too long to sit inside eighty pixels of column';
          return span;
        };
        const host = document.createElement('div');
        host.id = 'cutoff-fixture';
        host.style.cssText = 'position:fixed;left:0;top:0;width:80px;height:20px;z-index:9999;';
        host.append(line(0), line(innerHeight * 3));
        document.body.append(host);
      });
      const lines = (await page.evaluate(probe, null)).filter((f) => String(f.selector).includes('cutoff-fixture-line'));
      assert.equal(lines.length, 1, 'only the line inside the viewport is a finding');
    } finally { await page.close(); }
  });

  test('Issue #937: widening the row window parks more rows off screen and changes no finding', async () => {
    const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
    try {
      await page.goto(`${s.base}/#/table/${s.tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const drawn = () => page.locator('.wv-grid tbody tr.entity-row').count();
      const nudge = () => page.evaluate(() => {
        const wrap = document.querySelector('.wv-grid')?.closest('.wv-grid-scroll') ?? document.querySelector('#main');
        wrap.scrollTop = 1;
        wrap.dispatchEvent(new Event('scroll'));
        wrap.scrollTop = 0;
        wrap.dispatchEvent(new Event('scroll'));
      });
      const before = { rows: await drawn(), found: (await page.evaluate(probe, null)).length };
      await page.evaluate(() => {
        const gw = globalThis.WeaveGridWindow;
        const base = gw.windowFor.bind(gw);
        gw.windowFor = (a) => base({ ...a, viewportH: (Number(a.viewportH) || 0) * 3 });
      });
      await nudge();
      await page.waitForFunction((n) => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > n, before.rows, { timeout: 10000 });
      const after = { rows: await drawn(), found: (await page.evaluate(probe, null)).length };
      assert.ok(after.rows > before.rows, `a wider window draws more rows (${before.rows} then ${after.rows})`);
      assert.equal(after.found, before.found, `${after.found - before.found} findings came from rows nobody can see`);
    } finally { await page.close(); }
  });

  for (const cell of Object.keys(CELLS)) {
    test(`${cell}: every surface opens and no cut-off text passes the baseline ceiling`, async (t) => {
      const m = matrix[cell];
      if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here, and the ${cell} baseline is measured in it`);
      const { findings, failed } = await sweepCell(m.browser, cell, s, { page: m.page });
      assert.deepEqual(failed, [], 'a journey or overlay could not finish: its selectors rotted');
      const seen = tally(findings);
      const { added, stale } = verdict(seen, baseline, { cells: [cell] });
      for (const a of added) {
        const e = findings.find((x) => fingerprint(x, x.cell) === a.fp);
        t.diagnostic(`new: ${a.fp} at ${e.where}: ${JSON.stringify(e.text)} cut by ${e.px}px`);
      }
      for (const x of stale) t.diagnostic(`stale: ${x.fp} measured ${x.seen} against ${x.baseline}; once that count holds across runs, lower it with node scripts/cutoff-sweep.mjs --lower`);
      if (added.length || stale.length) t.diagnostic(`${PLATFORM} ${cell} measured: ${JSON.stringify(seen)}`);
      assert.deepEqual(added, [], `new cut-off text on ${PLATFORM}: fix it; test/cutoff-baseline.json never gains a row or a count`);
    });
  }
}
