import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from './lib/browser.mjs';

const PAGE = fileURLToPath(new URL('../docs/ui-catalog/index.html', import.meta.url));

if (!chromium) test('ui catalog page (browser)', { skip: 'playwright not installed' }, () => {});
else {
  const browser = await chromium.launch();
  test.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForFunction(() => window.uiCatalog?.ready === true, null, { timeout: 30000 });
  await page.evaluate(() => window.uiCatalog.renderAll());

  test('the catalog page opens with no script error and lists every function entry', async () => {
    assert.ok(existsSync(PAGE));
    assert.deepEqual(errors, []);
    const counts = await page.evaluate(() => ({ entries: document.querySelectorAll('section.fn').length, functions: window.uiCatalog.data.functions.length }));
    assert.equal(counts.entries, counts.functions);
  });

  test('rebuilt ancestors draw no pseudo-elements, so a sheet grab handle never leaks onto a chip', async () => {
    const leaks = await page.evaluate(() => {
      const out = [];
      for (const host of document.querySelectorAll('.view-host')) for (const a of host.shadowRoot?.querySelectorAll('.anc') ?? []) {
        for (const p of ['::before', '::after']) {
          const cs = getComputedStyle(a, p);
          if (cs.content !== 'none' && cs.content !== 'normal' && cs.display !== 'none') out.push(`${host.closest('.ctl')?.id} ${a.className} ${p}`);
        }
      }
      return out.slice(0, 20);
    });
    assert.deepEqual(leaks, []);
  });

  test('wide specimens scroll inside their view and nothing on the way up clips them', async () => {
    const clipped = await page.evaluate(() => {
      const out = [];
      for (const stage of document.querySelectorAll('.view-stage')) {
        if (!/auto|scroll/.test(getComputedStyle(stage).overflowX)) out.push(`${stage.closest('.ctl')?.id} stage overflow ${getComputedStyle(stage).overflowX}`);
        for (let e = stage.parentElement; e && !e.matches('main'); e = e.parentElement) {
          const o = getComputedStyle(e).overflowX;
          if (o === 'hidden' || o === 'clip') out.push(`${stage.closest('.ctl')?.id} clipped by ${e.className}`);
        }
      }
      return [...new Set(out)].slice(0, 20);
    });
    assert.deepEqual(clipped, []);
  });

  test('dialogs render as their panel, never a full-screen backdrop, and the tray sits still', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const host of document.querySelectorAll('.ctl[data-cat="dialog"] .view-host')) {
        const root = host.shadowRoot?.querySelector('.spec-root');
        if (!root) { out.push(`${host.closest('.ctl').id} has no specimen`); continue; }
        const cs = getComputedStyle(root);
        if (/-back$/.test(root.id)) out.push(`${host.closest('.ctl').id} draws the backdrop ${root.id}`);
        if (cs.position === 'fixed') out.push(`${host.closest('.ctl').id} is position fixed`);
        if (cs.transform !== 'none') out.push(`${host.closest('.ctl').id} transform ${cs.transform}`);
      }
      return out.slice(0, 20);
    });
    assert.deepEqual(bad, []);
  });

  test('table cells render inside a table with their header row', async () => {
    const lone = await page.evaluate(() => {
      const out = [];
      for (const host of document.querySelectorAll('.ctl[data-cat="cell"] .view-host')) {
        const root = host.shadowRoot?.querySelector('.spec-root');
        if (root && root.tagName === 'TABLE' && !root.querySelector('thead th')) out.push(host.closest('.ctl').id);
        if (root && /^(TD|TH)$/.test(root.tagName)) out.push(host.closest('.ctl').id);
      }
      return out;
    });
    assert.deepEqual(lone, []);
  });

  test('each entry shows desktop and phone views in light and dark side by side', async () => {
    const views = await page.evaluate(() => {
      const ctl = [...document.querySelectorAll('.ctl')].find((c) => [...c.querySelectorAll('.look')][0]?.querySelectorAll('.view[data-view] .view-host').length === 4);
      if (!ctl) return null;
      return [...ctl.querySelectorAll('.view[data-view]')].slice(0, 4).map((v) => [v.dataset.view, v.querySelector('.view-host')?.shadowRoot?.querySelector('.sh-html')?.getAttribute('data-bs-theme')]);
    });
    assert.deepEqual(views, [['desktop-light', 'light'], ['desktop-dark', 'dark'], ['phone-light', 'light'], ['phone-dark', 'dark']]);
  });
}
