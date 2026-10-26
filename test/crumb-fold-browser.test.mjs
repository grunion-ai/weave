import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

let steps, chain, long;
const s = await launch('crumb fold', (weave) => {
  weave.createSpace({ name: 'Ops', icon: 'lucide:folder-kanban' });
  steps = weave.createTable({ space: 'Ops', name: 'Steps', icon: 'lucide:rocket' });
  weave.addRelation(steps, { name: 'Next', targetDb: steps.id, cardinality: 'many-to-one', inverseName: 'Previous' });
  chain = [];
  for (let i = 5; i >= 0; i--) {
    chain.unshift(weave.createEntity(steps, {
      name: `Step ${i} of a journey long enough to need a fold in the crumb`,
      ...(chain[0] ? { Next: chain[0].id } : {}),
    }));
  }
  long = weave.createEntity(steps, { name: `Step 9 ${'of a record whose name runs on and on, '.repeat(5)}until the crumb has to give way` });
});

if (s) {
  const { base, browser } = s;
  const docked = (page, i) => page.waitForFunction((n) => document.querySelector('#dock .name-edit')?.value.startsWith(n), `Step ${i} `);
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
    await page.waitForFunction(() => !document.querySelector('.crumb-fold-menu'));
    await page.close();
  });

  async function record(id, width = 1200) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value && document.querySelector('#main .crumb-path .crumb-cur'));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page;
  }
  const readHeads = (page) => page.evaluate(() => {
    const path = document.querySelector('#main .crumb-path');
    const p = path.getBoundingClientRect();
    const nm = (n) => n.querySelector('.crumb-nm');
    const cut = (n) => n.scrollWidth - n.clientWidth > 1;
    const heads = [...path.querySelectorAll(':scope > .crumb-slot:not(.crumb-slot-cur)')].map(nm);
    const cur = path.querySelector('.crumb-cur');
    const c = cur.getBoundingClientRect();
    return {
      ws: document.querySelector('#ws-name').textContent,
      heads: heads.map((n) => n.textContent),
      cut: heads.filter(cut).map((n) => n.textContent),
      cur: nm(cur).textContent,
      curCut: cut(nm(cur)),
      curIn: c.left >= p.left - 0.5 && c.right <= p.right + 0.5,
      over: path.scrollWidth - path.clientWidth,
      title: document.querySelector('#main .name-edit').value,
    };
  });
  const crumbFinds = async (page) => (await page.evaluate(probe, '#main .crumb-path')).filter((f) => /crumb-k-(ws|space|table)|crumb-cur/.test(f.selector));

  test('the record page shows the workspace, space and table crumbs whole (Issue #1127)', async () => {
    const page = await record(chain[0].id);
    const m = await readHeads(page);
    assert.ok(m.ws.length > 14, `the workspace name is longer than the old 14ch cap: ${JSON.stringify(m.ws)}`);
    assert.deepEqual(m.heads, [m.ws, 'Ops', 'Steps'], 'the workspace, space and table crumbs all show');
    assert.deepEqual(m.cut, [], 'and none of them is cut');
    assert.deepEqual(await crumbFinds(page), [], 'the cut-off probe reads nothing in the crumbs');
    await page.close();
  });

  test('a long row name gives way first: the head crumbs keep their width, the current crumb takes the ellipsis and the title below carries the name (Issues #1158, #1159)', async () => {
    const page = await record(long.id);
    const m = await readHeads(page);
    assert.deepEqual(m.heads, [m.ws, 'Ops', 'Steps'], 'the head crumbs all show');
    assert.deepEqual(m.cut, [], `no head crumb is cut: ${JSON.stringify(m)}`);
    assert.ok(m.curCut, 'the current crumb ends in its own ellipsis');
    assert.ok(m.curIn && m.over <= 1, `and stays inside the path box: ${JSON.stringify(m)}`);
    assert.equal(m.title, m.cur, 'the title field under the crumb carries the full name');
    assert.deepEqual(await crumbFinds(page), [], 'the probe takes the current crumb\'s ellipsis as by design and sees no crumb pushed out of the box');
    await page.close();
  });

  test('the probe still reports a current crumb pushed out of its path box', async () => {
    const page = await record(long.id);
    await page.evaluate(() => {
      const path = document.querySelector('#main .crumb-path');
      for (const sl of path.querySelectorAll(':scope > .crumb-slot')) sl.style.flex = 'none';
      path.style.flex = 'none';
      path.style.width = '160px';
    });
    await page.waitForFunction(() => document.querySelector('#main .crumb-path').clientWidth === 160);
    const found = (await crumbFinds(page)).filter((f) => /crumb-cur/.test(f.selector));
    assert.equal(found.length, 1, `one finding on the current crumb: ${JSON.stringify(found)}`);
    assert.equal(found[0].kind, 'clipped');
    assert.ok(found[0].px > 100, `measured how far it sits outside the box: ${found[0].px}px`);
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

if (s) {
  const { base, browser } = s;
  test('the "…" menu stays inside the window when the dock sits at its right edge', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('wv-dock-width', '420'));
    await page.goto(`${base}/#/table/${steps.id}?e=${chain[0].id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value.startsWith('Step 0 '));
    for (let i = 1; i <= 5; i++) {
      await page.click(`#dock .entity-grid a[href="#/entity/${chain[i].id}"]`);
      await page.waitForFunction((n) => document.querySelector('#dock .name-edit')?.value.startsWith(n), `Step ${i} `);
    }
    await page.click('#dock .crumb-more');
    await page.waitForSelector('.crumb-fold-menu');
    const r = await page.evaluate(() => { const b = document.querySelector('.crumb-fold-menu').getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth }; });
    assert.ok(r.l >= 0 && r.r <= r.w, `the menu is inside the window: ${JSON.stringify(r)}`);
    await page.close();
  });
}
