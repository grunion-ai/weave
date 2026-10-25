import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf } from './lib/browser.mjs';
import { PAINT_PROBE, paintMisses } from './lib/chip-paint.mjs';

const ENGINES = ['chromium', 'webkit'];
const THEMES = ['light', 'dark'];

const s = await launch('chip paint contract', () => {});

if (s) {
  const { base } = s;

  const paintedMatrix = async (engine, theme) => {
    const browser = await engineOf(engine);
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.chipCore && window.weaveChipView);
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.evaluate(PAINT_PROBE);
    const rows = await page.evaluate(() => {
      const core = window.chipCore;
      const view = window.weaveChipView;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const cases = [];
      for (const kind of ['k-select', 'k-multi']) {
        for (const hue of core.HUES) {
          cases.push({ where: `${kind} hue=${hue}`, cls: `k ${kind} hue-${hue}`, hue: core.hueName(hue) });
        }
      }
      for (const c of core.CATEGORIES) {
        const cat = core.categoryOrDefault(c.id);
        for (const hue of core.HUES) {
          const seg = { category: c.id, hue };
          cases.push({ where: `k-state cat=${c.id} hue=${hue}`, cls: view.stateClass(seg), hue: core.stateHue(seg, cat) });
        }
        const bare = { category: c.id };
        cases.push({ where: `k-state cat=${c.id} no hue`, cls: view.stateClass(bare), hue: core.stateHue(bare, cat) });
      }
      const out = cases.map((x) => {
        const chip = document.createElement('span');
        chip.className = x.cls;
        chip.textContent = 'Chip';
        host.appendChild(chip);
        return { where: x.where, hue: x.hue, got: window.paintOf(chip), want: window.huePaint(x.hue) };
      });
      host.remove();
      return out;
    });
    await page.close();
    return rows;
  };

  for (const engine of ENGINES) {
    for (const theme of THEMES) {
      test(`every value chip paints the hue its data names (${engine}, ${theme})`, async () => {
        const rows = await paintedMatrix(engine, theme);
        assert.equal(rows.length, 64, 'k-select and k-multi for ten hues, k-state for four categories by ten hues plus none');
        assert.ok(rows.some((r) => r.where === 'k-state cat=in-progress hue=green'), 'the Net case is in the matrix');
        assert.notEqual(rows.find((r) => r.hue === 'green').want.fill, rows.find((r) => r.hue === 'blue').want.fill,
          'the probe tells green from blue');
        assert.deepEqual(paintMisses(rows), [], `chips painted off their data in ${engine} ${theme}`);
      });
    }
  }
}
