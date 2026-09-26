/* The entity page hierarchy (F6, 2026-09-26 design pass on v0.4.31),
   driven through a real browser on the demo seed at 1440 x 900.

   Measured before the fix: the Description opened with a 26px H1 repeating
   the 20px page title; the FIELDS caret sat 18px left of DESCRIPTION's; the
   Apollo Launch "Task List" rollup printed on one line and widened the page
   to 1576px; `[[Task#1]]` read "# Task#1 —" and the `[[Project#2|Hermes
   Docs]]` chip trailed ~90px of tint past its label.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seed } from '../scripts/seed.mjs';

let h;
const s = await launch('entity hierarchy', (weave) => {
  h = seed(weave);
  // Enough long task names that no layout fits the joined rollup on one line.
  for (let i = 1; i <= 6; i++) {
    weave.createEntity(h.tasks, {
      name: `Migrate the regional billing ledger export pipeline, phase ${i}`,
      values: { Project: 'Apollo Launch' },
    });
  }
  // A first H1 that is not the record name is a real heading.
  weave.setDoc(h.t2.id, '# Metering plan\n\nUsage-based endpoints.\n', 'Description');
});

if (s) {
  const { base, browser } = s;
  const open = async (id, colorScheme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir .vditor-reset > *', { state: 'attached', timeout: 20000 });
    return page;
  };

  test('a document H1 that repeats the record name is hidden: one visible title', async () => {
    const page = await open(h.t1.id);
    try {
      await page.waitForSelector('.vditor-reset > h1.wv-title-echo', { state: 'attached', timeout: 20000 });
      const r = await page.evaluate(() => {
        const name = document.querySelector('.entity-head .name-edit').value;
        const visibleH1 = [...document.querySelectorAll('.vditor-reset > h1')]
          .filter((e) => e.offsetParent !== null).map((e) => e.textContent);
        const title = getComputedStyle(document.querySelector('.entity-head .name-edit')).fontSize;
        const h2 = document.querySelector('.vditor-reset > h2');
        return {
          name, visibleH1, title,
          h2: h2 && getComputedStyle(h2).fontSize,
          value: window.__weaveEditors.values().next().value.getValue(),
        };
      });
      assert.equal(r.name, 'Design onboarding wizard');
      assert.deepEqual(r.visibleH1, [], 'the echoing H1 is not on screen');
      assert.equal(r.title, '24px', 'the page title leads the scale');
      assert.equal(r.h2, '18px', 'a document heading sits below the page title');
      assert.match(r.value, /^# Design onboarding wizard/, 'the markdown keeps the heading');
    } finally { await page.close(); }
  });

  test('a first H1 that says something else stays visible at 20px', async () => {
    const page = await open(h.t2.id);
    try {
      await page.waitForFunction(() => document.querySelector('.vditor-reset > h1')?.offsetParent != null, null, { timeout: 20000 });
      const r = await page.evaluate(() => {
        const h1 = document.querySelector('.vditor-reset > h1');
        return { echo: h1.classList.contains('wv-title-echo'), size: getComputedStyle(h1).fontSize };
      });
      assert.equal(r.echo, false);
      assert.equal(r.size, '20px');
    } finally { await page.close(); }
  });

  for (const scheme of ['light', 'dark']) {
    test(`a long rollup wraps inside its cell and the page never scrolls sideways (${scheme})`, async () => {
      const page = await open(h.apollo.id, scheme);
      try {
        const r = await page.evaluate(() => {
          const doc = document.documentElement;
          const row = [...document.querySelectorAll('.entity-fields .fieldrow')]
            .find((x) => x.dataset.field === 'Task List');
          const value = row.querySelector('.k-computed').getBoundingClientRect();
          return {
            scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
            valueRight: value.right, rowRight: row.getBoundingClientRect().right, valueHeight: value.height,
          };
        });
        assert.ok(r.scrollWidth <= r.clientWidth, `page scrollWidth ${r.scrollWidth} > clientWidth ${r.clientWidth}`);
        assert.ok(r.valueRight <= r.rowRight + 1, 'the rollup stays inside its row');
        assert.ok(r.valueHeight > 30, 'the joined names wrap onto more than one line');
      } finally { await page.close(); }
    });
  }

  test('every block caret sits on one x', async () => {
    const page = await open(h.t1.id);
    try {
      const xs = await page.evaluate(() =>
        [...document.querySelectorAll('.entity-body .doc-caret')].map((c) => Math.round(c.getBoundingClientRect().left)));
      assert.ok(xs.length >= 3, `FIELDS, DESCRIPTION and SPEC carets, got ${xs.length}`);
      assert.equal(new Set(xs).size, 1, `carets at ${xs.join(', ')}`);
    } finally { await page.close(); }
  });

  test('a mention reads as its record name, and its tint ends at the label', async () => {
    const apollo = await open(h.apollo.id);
    try {
      await apollo.waitForSelector('.doc-ref-layer a.mention .doc-ref-label', { timeout: 20000 });
      const bare = await apollo.evaluate(() => {
        const chip = document.querySelector('.doc-ref-layer a.mention');
        return { label: chip.textContent, title: chip.title };
      });
      assert.equal(bare.label, 'Design onboarding wizard', '[[Task#1]] shows the name, not the ref');
      assert.equal(bare.title, 'Task#1 — Design onboarding wizard', 'the ref stays on as the tooltip');
    } finally { await apollo.close(); }

    const task = await open(h.t1.id);
    try {
      await task.waitForSelector('.doc-ref-layer a.mention .doc-ref-label', { timeout: 20000 });
      const r = await task.evaluate(() => {
        const chip = document.querySelector('.doc-ref-layer a.mention');
        const label = chip.querySelector('.doc-ref-label');
        return {
          text: label.textContent,
          chip: chip.getBoundingClientRect().width,
          label: label.getBoundingClientRect().width,
          natural: label.scrollWidth,
          chipTint: getComputedStyle(chip).backgroundImage + getComputedStyle(chip).boxShadow,
        };
      });
      assert.equal(r.text, 'Hermes Docs');
      assert.ok(r.label < r.chip - 20, `the tint (${r.label}px) hugs the label inside the ${r.chip}px cover`);
      assert.ok(Math.abs(r.label - r.natural) <= 1, 'the label is its own width, not the literal\'s');
      assert.equal(r.chipTint, 'nonenone', 'the cover itself carries no tint or ring');
    } finally { await task.close(); }
  });
}
