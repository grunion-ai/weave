import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedDemo, openRecord } from './lib/phone-matrix.mjs';

const s = await launch('relation chip gaps', (weave) => seedDemo(weave));

if (s) {
  const { base, browser, tasks, t4 } = s;
  const ROW = '#dock .fieldrow[data-field="Project"]';
  const gaps = (page) => page.evaluate((row) => {
    const parts = [...document.querySelector(`${row} .k-rel`).children]
      .map((n) => ({ cls: String(n.className).split(' ').at(-1), r: n.getBoundingClientRect() }))
      .filter((p) => p.r.width > 0 && p.r.height > 0)
      .sort((a, b) => a.r.left - b.r.left);
    return parts.slice(1).map((p, i) => ({ between: `${parts[i].cls} and ${p.cls}`, gap: Math.round(p.r.left - parts[i].r.right) }));
  }, ROW);

  for (const width of [1400, 700]) {
    test(`a relation chip spaces its state, name, open and remove parts with one gap at ${width} px (Issue #1392)`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await openRecord(page, base, tasks, t4);
        const g = await gaps(page);
        assert.ok(g.length >= 2, `the chip draws its state, name and open parts: ${JSON.stringify(g)}`);
        const spread = Math.max(...g.map((x) => x.gap)) - Math.min(...g.map((x) => x.gap));
        assert.ok(spread <= 1, `the chip's gaps differ by ${spread} px: ${g.map((x) => `${x.between} ${x.gap}`).join(', ')}`);
      } finally { await page.close(); }
    });

    test(`+ link sits at the relation chip's height and top at ${width} px (Issue #1392)`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await openRecord(page, base, tasks, t4);
        const v = await page.evaluate((row) => {
          const box = (n) => n.getBoundingClientRect();
          const chip = box(document.querySelector(`${row} .k-rel`));
          const add = box(document.querySelector(`${row} .ms-box > .btn.tiny`));
          return { chip: [Math.round(chip.top), Math.round(chip.height)], add: [Math.round(add.top), Math.round(add.height)] };
        }, ROW);
        assert.deepEqual(v.add, v.chip, `+ link top and height ${v.add} against the chip's ${v.chip}`);
      } finally { await page.close(); }
    });
  }
}
