/* The outline rail opens in place (Issues #131, #144).
   Kyle, 2026-09-01: the outline "pop up on click does not overlap small
   outline lines and snaps to the center"; 2026-09-02: "outline bar preview
   snaps and is disjointed". The panel was position:fixed at the viewport's
   middle, so the headings jumped away from the dashes the reader had just
   clicked. Only a live layout can show where the panel lands.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DOC = '# One\n\ntext\n\n## Two\n\n' + 'filler\n\n'.repeat(40)
  + '## Three\n\n' + 'more\n\n'.repeat(40) + '### Four\n\nend\n';

let table, target;
const s = await launch('outline rail placement', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Note' });
  target = weave.createEntity(table, { name: 'Outlined' });
  weave.setDoc(target.id, DOC, 'Description');
});

if (s) {
  const { base, browser } = s;
  const box = (page) => page.evaluate(() => {
    const t = document.querySelector('.doc-rail .doc-rail-track');
    const r = t.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), open: t.parentElement.classList.contains('open') };
  });

  test('clicking the minimap widens it where it is — same top, same left edge', async () => {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${target.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
    // Scrolled into the document, so the sticky track is pinned mid-page —
    // the case where a viewport-centred panel and an in-place one differ.
    // The main panel is the page's scroller since Issue #609.
    await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 400, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#main').scrollTop >= 395, null, { timeout: 20000 });
    const closed = await box(page);
    assert.equal(closed.open, false);
    await page.evaluate(() => document.querySelector('.doc-rail').click());
    await page.waitForSelector('.doc-rail.open', { timeout: 20000 });
    await page.waitForTimeout(250);
    const open = await box(page);
    assert.equal(open.open, true);
    assert.ok(open.width > closed.width + 60, `the panel is wider than the minimap (${closed.width} → ${open.width})`);
    assert.ok(Math.abs(open.top - closed.top) <= 2, `same top: minimap ${closed.top}, panel ${open.top}`);
    assert.ok(Math.abs(open.left - closed.left) <= 2, `same left edge: minimap ${closed.left}, panel ${open.left}`);
    const labels = await page.$$eval('.doc-rail.open .doc-rail-label', (ns) => ns.filter((n) => n.offsetParent !== null).length);
    assert.ok(labels >= 4, 'the headings are readable in the open panel');
    await page.close();
  });

  /* Issue #269: a window resize fired every rail's schedule on every event.
     A burst of resize events now costs one pass per animation frame. */
  test('a burst of resize events reschedules the rails once per frame', async () => {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${target.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
    const calls = await page.evaluate(async () => {
      const real = window.setTimeout;
      let n = 0;
      /* Four document layers share the 250 ms debounce (rails, reference
         chips, code colouring, heading folds), and code colouring polls on
         it until highlight.js has loaded, which on a loaded machine is
         still going when this runs (Issue #454). Count the rails' own. */
      window.setTimeout = (fn, ms, ...rest) => { if (ms === 250 && /refreshDashRail/.test(String(fn))) n++; return real(fn, ms, ...rest); };
      try {
        for (let i = 0; i < 30; i++) window.dispatchEvent(new Event('resize'));
        const sync = n;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { sync, framed: n, rails: document.querySelectorAll('.doc-rail').length };
      } finally { window.setTimeout = real; }
    });
    assert.ok(calls.rails >= 1, 'the page has a rail to reschedule');
    assert.equal(calls.sync, 0, `no rail work inside the burst (saw ${calls.sync})`);
    assert.ok(calls.framed >= 1 && calls.framed <= calls.rails, `one reschedule per rail after the frame (saw ${calls.framed} for ${calls.rails})`);
    await page.close();
  });
}
