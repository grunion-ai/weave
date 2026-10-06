/* The crumb folds its middle instead of cutting off the row you are on
   (Issues #668, #672). Measured on live :4400: the dock's crumb held 743px
   of text in a 283px box, and `text-overflow: ellipsis` cut the right end,
   which is where the current row sits. And MAX_TRAIL = 4 dropped a fifth
   hop with no sign. Now ancestors cap at about 17 characters, the middle
   folds into a "…" button whose menu lists the hidden hops, the first
   crumb and the last two always show, and nothing is dropped.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let steps, chain;
const s = await launch('crumb fold', (weave) => {
  weave.createSpace({ name: 'Ops', icon: 'lucide:layers' });
  steps = weave.createTable({ space: 'Ops', name: 'Steps', icon: 'lucide:rocket' });
  weave.addRelation(steps, { name: 'Next', targetDb: steps.id, cardinality: 'many-to-one', inverseName: 'Previous' });
  chain = [];
  for (let i = 5; i >= 0; i--) {
    chain.unshift(weave.createEntity(steps, {
      name: `Step ${i} of a journey long enough to need a fold in the crumb`,
      ...(chain[0] ? { Next: chain[0].id } : {}),
    }));
  }
});

if (s) {
  const { base, browser } = s;
  const docked = (page, i) => page.waitForFunction((n) => document.querySelector('#dock .name-edit')?.value.startsWith(n), `Step ${i} `);
  /* Dock step 0, then hop through Next to step `to`. */
  async function walk({ to = 5, width = 1200, pin = 550 } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.addInitScript((pin) => localStorage.setItem('wv-dock-width', String(pin)), pin);
    await page.goto(`${base}/#/table/${steps.id}?e=${chain[0].id}`, { waitUntil: 'networkidle' });
    await docked(page, 0);
    for (let i = 1; i <= to; i++) {
      await page.click(`#dock .entity-grid a[href="#/entity/${chain[i].id}"]`);
      await docked(page, i);
    }
    return page;
  }
  const read = (page) => page.evaluate(() => {
    const path = document.querySelector('#dock .crumb-path');
    const p = path.getBoundingClientRect();
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; };
    const slots = [...path.querySelectorAll(':scope > .crumb-slot:not(.crumb-more-slot)')];
    const cur = path.querySelector('.crumb-cur');
    return {
      path: { l: p.left, r: p.right, scroll: path.scrollWidth, client: path.clientWidth },
      shown: slots.filter((s) => !s.hidden).map((s) => s.querySelector('.crumb-nm').textContent.slice(0, 6)),
      count: slots.length,
      more: !!path.querySelector('.crumb-more'),
      cur: { ...box(cur), pid: box(cur.querySelector('.crumb-pid')), nm: box(cur.querySelector('.crumb-nm')) },
    };
  });

  test('a narrow dock folds the middle: the first crumb, the last two and the whole current crumb stay in the box', async () => {
    const page = await walk();
    const m = await read(page);
    assert.equal(m.count, 6, `every hop is on the trail, none dropped past four (Issue #672): ${m.count}`);
    assert.ok(m.more, 'the middle folded into a "…" button');
    assert.equal(m.shown[0], 'Step 0', 'the first crumb stays');
    assert.deepEqual(m.shown.slice(-2), ['Step 4', 'Step 5'], 'the last two stay');
    assert.ok(m.cur.l >= m.path.l - 0.5 && m.cur.r <= m.path.r + 0.5, `the current crumb is inside the path box: ${JSON.stringify(m)}`);
    assert.ok(m.cur.pid.r <= m.path.r + 0.5, 'its #id shows');
    assert.ok(m.cur.nm.w > 40, `and some of its Name, ending in its own ellipsis: ${m.cur.nm.w}px`);
    assert.ok(m.path.scroll <= m.path.client + 1, `nothing runs past the box's right edge: ${m.path.scroll} > ${m.path.client}`);
    await page.close();
  });

  test('the "…" menu lists the hidden hops with #id and Name, and choosing one goes there', async () => {
    const page = await walk();
    const hidden = await page.$$eval('#dock .crumb-path > .crumb-slot[hidden] .crumb-nm', (ns) => ns.map((n) => n.textContent));
    assert.ok(hidden.length >= 1, 'something is folded');
    await page.click('#dock .crumb-more');
    await page.waitForSelector('.crumb-fold-menu');
    const rows = await page.$$eval('.crumb-fold-menu .crumb-fold-row', (rs) => rs.map((r) => ({
      pid: r.querySelector('.crumb-pid')?.textContent, name: r.querySelector('.crumb-nm')?.textContent, svg: !!r.querySelector('svg'),
    })));
    assert.deepEqual(rows.map((r) => r.name), hidden, 'the menu holds exactly the folded crumbs, in trail order');
    for (const r of rows) {
      assert.match(r.pid, /^#\d+$/, 'each row carries its #id');
      assert.ok(r.svg, 'and its table icon');
    }
    assert.equal(await page.getAttribute('#dock .crumb-more', 'aria-expanded'), 'true');
    await page.click('.crumb-fold-menu .crumb-fold-row >> nth=0');
    await page.waitForFunction((n) => document.querySelector('#dock .name-edit')?.value === n, hidden[0]);
    assert.equal(await page.locator('.crumb-fold-menu').count(), 0, 'the menu closes');
    await page.close();
  });

  test('widening the dock unfolds the trail (the fit follows the box)', async () => {
    const page = await walk({ to: 3 });
    assert.ok((await read(page)).more, 'folded at 550px');
    await page.evaluate(() => { document.querySelector('#dock').style.flex = '0 1 1400px'; });
    await page.setViewportSize({ width: 2400, height: 800 });
    await page.waitForFunction(() => !document.querySelector('#dock .crumb-more'));
    const m = await read(page);
    assert.deepEqual(m.shown, ['Step 0', 'Step 1', 'Step 2', 'Step 3'], 'every crumb shows again');
    await page.close();
  });
}
