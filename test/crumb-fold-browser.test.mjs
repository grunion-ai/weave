import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const UNBROKEN = 'Antidisestablishmentarianism'.repeat(4);
let steps, chain, long, wide;
const s = await launch('crumb fold', (weave) => {
  weave.createSpace({ name: 'Ops', icon: 'lucide:folder-kanban' });
  steps = weave.createTable({ space: 'Ops', name: 'Steps', icon: 'lucide:rocket' });
  long = weave.createEntity(steps, { name: UNBROKEN });
  weave.createSpace({ name: 'Operations and logistics planning', icon: 'lucide:folder-kanban' });
  wide = weave.createTable({ space: 'Operations and logistics planning', name: 'Quarterly vendor renewal checklist', icon: 'lucide:rocket' });
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

  test('a narrow dock folds the middle, then the last-but-one: the first crumb and the whole current crumb stay in the box (Issue #765)', async () => {
    const page = await walk();
    const m = await read(page);
    assert.equal(m.count, 6, `every hop is on the trail, none dropped past four (Issue #672): ${m.count}`);
    assert.ok(m.more, 'the middle folded into a "…" button');
    assert.equal(m.shown[0], 'Step 0', 'the first crumb stays');
    assert.deepEqual(m.shown, ['Step 0', 'Step 5'], 'the dock row with Share leaves no room for the last-but-one beside the current crumb\'s floor, so it folds too');
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

if (s) {
  const { base, browser } = s;
  test('a long row name gives way first: the workspace, space and table crumbs stay whole and the title shows the full name (Issues #1127, #1158, #1159)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/entity/${long.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .crumb-path .crumb-cur');
    const m = await page.evaluate(() => {
      const whole = (n) => n && { text: n.textContent, shown: n.getClientRects().length > 0, cut: n.scrollWidth - n.clientWidth };
      const path = document.querySelector('#main .crumb-path');
      return {
        trail: ['ws', 'space', 'table'].map((k) => whole(path.querySelector(`.crumb-slot:not(.crumb-slot-cur) > .crumb-k-${k} > .crumb-nm`))),
        cur: whole(path.querySelector('.crumb-cur .crumb-nm')),
        title: document.querySelector('#main .name-edit')?.value,
        overflow: path.scrollWidth - path.clientWidth,
      };
    });
    for (const [i, c] of m.trail.entries()) {
      assert.ok(c?.shown, `the ${['workspace', 'space', 'table'][i]} crumb shows: ${JSON.stringify(c)}`);
      assert.ok(c.cut <= 0, `${JSON.stringify(c.text)} is cut by ${c.cut}px`);
    }
    assert.ok(m.trail[0].text.length > 14, `the workspace name is long enough to have been capped at 14ch: ${m.trail[0].text}`);
    assert.ok(m.cur.cut > 0, 'the current crumb is the one that gives way');
    assert.equal(m.title, UNBROKEN, 'and the title row under it shows the full name');
    assert.ok(m.overflow <= 1, `nothing runs past the path box: ${m.overflow}px`);
    await page.close();
  });

  const slack = (page) => page.evaluate(() => {
    const path = document.querySelector('#main .crumb-path');
    const above = (slot) => Math.round(slot.getBoundingClientRect().width - parseFloat(getComputedStyle(slot).minWidth));
    return { space: above(path.querySelector('.crumb-slot:has(> .crumb-k-space)')), cur: above(path.querySelector('.crumb-slot-cur')), path: path.clientWidth };
  });
  const phone = await phoneBrowser();
  const engines = [['chromium', (width) => browser.newPage({ viewport: { width, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', (width) => phonePage(phone, { viewport: { width, height: 844 } })]);
  for (const [engine, open] of engines) {
    test(`on a phone the space crumb gives way before the current one (${engine}, Issues #1127, #1158)`, async () => {
      const at = async (width) => {
        const page = await open(width);
        await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main .crumb-path .crumb-cur');
        const m = await slack(page);
        await page.close();
        return m;
      };
      const roomy = await at(599);
      const tight = await at(390);
      assert.ok(roomy.cur - tight.cur > 10, `the narrow header squeezes the current crumb: ${JSON.stringify({ roomy, tight })}`);
      assert.ok(tight.cur > tight.space, `the current crumb keeps more room above its floor than the space crumb, which gives way first: ${JSON.stringify({ roomy, tight })}`);
    });
  }

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
