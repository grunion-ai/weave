import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';
import { CELLS, probe } from './lib/cutoff.mjs';
import { SEEDS } from './lib/states.mjs';

const s = await launch('compact number fallback', SEEDS.grid);

if (s) {
  const AMOUNT = '.wv-grid tbody tr.entity-row td[data-field="Amount"] .num-dressed';
  const FULL = '$98,765,432,109.87';

  test('Issue #1160: a currency too wide for its column shows the compact amount and keeps the full one in its title', async () => {
    const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
    try {
      await page.goto(`${s.base}/#/table/${s.sink.table}`, { waitUntil: 'networkidle' });
      await painted(page, AMOUNT);
      const texts = () => page.locator(AMOUNT).evaluateAll((nodes) => nodes.map((n) => n.textContent).sort());
      assert.deepEqual(await eventually(texts, ['$1,250,000.00', '$1.00', '$98.8B']), ['$1,250,000.00', '$1.00', '$98.8B'],
        'the amount that overflows compacts; the two that fit keep every digit');
      const big = page.locator(`${AMOUNT}[title="${FULL}"]`);
      assert.equal(await big.textContent(), '$98.8B');
      const fit = await big.evaluate((n) => n.scrollWidth - n.clientWidth);
      assert.ok(fit <= 1, `the compact amount still runs ${fit}px past its cell`);
      const findings = (await page.evaluate(probe, '.wv-grid')).filter((f) => f.kind === 'ellipsis' && String(f.selector).includes('num-dressed'));
      assert.deepEqual(findings, [], 'no dressed number is cut off in the grid');
    } finally { await page.close(); }
  });
}
