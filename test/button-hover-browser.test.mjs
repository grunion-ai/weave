import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const s = await launch('three hover treatments', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  for (const name of ['A', 'B', 'C']) weave.createEntity(jobs, { name });
});

const alphaOf = (css) => (css.match(/[\d.]+/g) ?? []).map(Number)[3] ?? 1;

if (s) {
  const { base, browser } = s;

  for (const theme of ['light', 'dark']) {
    test(`every button weight reads one hover token in ${theme} (Issue #760)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
      try {
        await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr.entity-row');

        const tokens = await page.evaluate(() => {
          const probe = document.createElement('div');
          document.body.append(probe);
          const read = (v) => { probe.style.background = v; return getComputedStyle(probe).backgroundColor; };
          const declared = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
          const out = {
            wash: read('var(--wv-hover-wash)'),
            border: read('var(--wv-hover-border)'),
            declaredWash: declared('--wv-hover-wash'),
            declaredBorder: declared('--wv-hover-border'),
            declaredDarken: declared('--tblr-primary-darken'),
            body: declared('--tblr-body-color'),
          };
          probe.remove();
          return out;
        });
        assert.notEqual(tokens.declaredWash, '', 'a --wv-hover-wash token exists');
        assert.notEqual(tokens.declaredBorder, '', 'a --wv-hover-border token exists');
        assert.ok(alphaOf(tokens.wash) < 1, `the quiet wash is translucent, never a solid block: ${tokens.wash}`);
        assert.match(tokens.declaredDarken, /color-mix/,
          'a filled primary darkens one step instead of fading to 80% alpha');

        const quiet = await page.locator('.btn-ghost-secondary').first().evaluate((n) => {
          const cs = getComputedStyle(n);
          return {
            bg: cs.getPropertyValue('--tblr-btn-hover-bg').trim(),
            color: cs.getPropertyValue('--tblr-btn-hover-color').trim(),
            border: cs.getPropertyValue('--tblr-btn-hover-border-color').trim(),
          };
        });
        assert.equal(quiet.bg, tokens.declaredWash, 'a quiet icon button washes instead of filling solid slate');
        assert.equal(quiet.color, tokens.body, 'and its glyph moves to body colour, not the inverse of a slate fill');
        assert.equal(quiet.border, 'transparent', 'and it grows no border on hover');

        const fab = await page.locator('.bug-fab').first().evaluate((n) => {
          const probe = document.createElement('div');
          n.after(probe);
          probe.style.borderColor = 'var(--wv-hover-border)';
          const out = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return out;
        });
        assert.equal(fab, tokens.border, 'the one hover grey reaches the bordered weight');
      } finally {
        await page.close();
      }
    });
  }
}
