import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedFieldShowcase } from '../src/weaver-seed.js';

let ft;
const s = await launch('showcase cells read as values', (weave) => {
  seedFieldShowcase(weave);
  ft = weave.findTable('Showcase/Field Types');
});

if (s) {
  const { base, browser } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const WRECKAGE = [
    ['an #ERR', (t) => t.includes('#ERR')],
    ['raw markup', (t) => /<[A-Za-z/!?]/.test(t)],
    ['only punctuation and whitespace', (t) => t.trim() !== '' && !/[\p{L}\p{N}]/u.test(t)],
  ];
  const drawnText = (row) => row.evaluate((tr) => Array.from(tr.querySelectorAll('td')).map((td) => {
    const copy = td.cloneNode(true);
    for (const mark of copy.querySelectorAll('.computed-mark, .is-empty')) mark.remove();
    return copy.textContent;
  }));

  for (const colorScheme of ['light', 'dark']) {
    test(`every cell the showcase grid draws reads as a value (${colorScheme}, Issue #580)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${ft.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        const heads = (await page.locator('.wv-grid thead th').allTextContents()).map((h) => h.trim());
        const rows = page.locator('.wv-grid tbody tr.entity-row');
        const count = await rows.count();
        assert.ok(count >= 4, `the showcase grid draws its rows (${count})`);
        const bad = [];
        for (let i = 0; i < count; i++) {
          const cells = await drawnText(rows.nth(i));
          assert.ok(cells.length >= 40, `row ${i} draws its columns (${cells.length})`);
          cells.forEach((text, j) => {
            for (const [rule, wrecked] of WRECKAGE) {
              if (wrecked(text)) bad.push(`${heads[j] || `column ${j}`} on row ${i} is ${rule}: ${JSON.stringify(text)}`);
            }
          });
        }
        assert.deepEqual(bad, []);
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/showcase-cells-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }
}
