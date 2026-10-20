import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIT = { width: 1600, height: 720 };

let tasks, wide, projects, alpha, seeded, broad, broadRows, ranked;
const s = await launch('sticky add row', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  projects = weave.createTable({ space: 'Work', name: 'Projects' });
  weave.addRelation(projects, { name: 'Tasks', targetDb: 'Tasks', cardinality: 'one-to-many', inverseName: 'Project' });
  alpha = weave.createEntity(projects, { name: 'Alpha' });
  seeded = [];
  for (let i = 0; i < 200; i++) seeded.push(weave.createEntity(tasks, { name: `task ${i}`, values: { Note: 'n' } }).id);
  wide = weave.createTable({ space: 'Work', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'text' });
  weave.createEntity(wide, { name: 'one' });
  broad = weave.createTable({ space: 'Work', name: 'Broad' });
  for (let i = 0; i < 12; i++) weave.addField(broad, { name: `A long column name ${i}`, type: 'text' });
  weave.addField(broad, { name: 'Rank', type: 'number' });
  broadRows = [];
  for (let i = 0; i < 260; i++) broadRows.push(weave.createEntity(broad, { name: `broad ${i}`, values: { Rank: (i * 37) % 260 } }).id);
  ranked = weave.createTable({ space: 'Work', name: 'Ranked' });
  weave.addField(ranked, { name: 'Rank', type: 'number' });
  for (let i = 0; i < 260; i++) weave.createEntity(ranked, { name: `ranked ${i}`, values: { Rank: (i * 37) % 260 } });
  weave.updateTable(ranked.id, { sort: [{ field: 'Rank', dir: 'desc' }] });
});

if (s) {
  const { base, browser } = s;
  const rect = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    return n ? { ...n.getBoundingClientRect().toJSON(), ih: innerHeight, iw: innerWidth } : null;
  }, sel);
  const inView = (r) => r.top >= 0 && r.bottom <= r.ih && r.height > 0;
  const overlap = (a, b) => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5 && a.left < b.right && b.left < a.right;
  const openTasks = async (page) => {
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${seeded[0]}"] td[data-field="Name"] input`);
    await page.waitForSelector('.wv-grid .add-entity-btn');
  };

  test('the + New row is on screen from the top of a 200-row table, once', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await openTasks(page);
    assert.equal(await page.evaluate(() => document.querySelector('#main').scrollTop), 0, 'the page opens at the top');
    assert.equal(await page.locator('.wv-grid .add-entity-btn').count(), 1, 'one foot button');
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(inView(btn), `the foot sits inside the viewport: ${JSON.stringify(btn)}`);
    assert.ok(btn.bottom > btn.ih - 60, 'and at its bottom edge');
    await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 2000, behavior: 'instant' }));
    await page.waitForTimeout(150);
    const th = await rect(page, '.wv-grid thead th.col-head');
    const chrome = await rect(page, '#main > .view-header');
    const panel = await rect(page, '#main');
    assert.ok(Math.abs(chrome.top - panel.top) < 2, `the view header is at the panel's top edge: top=${chrome.top} panel=${panel.top}`);
    assert.ok(th.top >= chrome.bottom - 1 && th.top < chrome.bottom + 40, `the field headers stay under it while scrolling: top=${th.top}, view header bottom=${chrome.bottom}`);
    const mid = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(inView(mid), 'the foot is still on screen mid-table');
    await page.close();
  });

  test('at the end of the table the foot rests in its natural place, the last row of the grid', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await openTasks(page);
    await page.evaluate(() => { const m = document.querySelector('#main'); m.scrollTo({ top: m.scrollHeight, behavior: 'instant' }); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.wv-grid .add-entity-btn').count(), 1, 'still exactly one');
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    const last = await rect(page, `tr[data-eid="${seeded[199]}"]`);
    assert.ok(inView(btn), 'visible at the end');
    assert.ok(btn.top >= last.bottom - 1, 'below the last row');
    assert.equal(await page.locator('.wv-grid tfoot').count(), 0, 'no footer under it');
    assert.ok(await page.$eval('.wv-grid tr.add-entity-row', (tr) => tr.nextElementSibling === null && tr.closest('table').tFoot === null), 'the foot is the last row');
    await page.close();
  });

  test('clicking it creates the row, focuses its Name cell, and the row is not under the foot', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await openTasks(page);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForFunction((ids) => {
      const cell = document.activeElement?.closest?.('tr[data-eid] > td');
      return !!cell && !ids.includes(cell.parentElement.dataset.eid);
    }, seeded, { timeout: 5000 });
    await page.waitForTimeout(400);
    const at = await page.evaluate(() => {
      const a = document.activeElement;
      const cell = a.closest('tr[data-eid] > td');
      const row = cell.parentElement;
      return { tag: a.tagName, field: cell.dataset.field, eid: row.dataset.eid, row: { ...row.getBoundingClientRect().toJSON(), ih: innerHeight } };
    });
    assert.equal(at.tag, 'INPUT');
    assert.equal(at.field, 'Name');
    assert.ok(!seeded.includes(at.eid), 'a new row');
    assert.ok(inView(at.row), `the new row is fully on screen: ${JSON.stringify(at.row)}`);
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(!overlap(at.row, btn), `the foot does not cover the new row: row=${JSON.stringify(at.row)} foot=${JSON.stringify(btn)}`);
    await page.close();
  });

  test('a grid wider than its card keeps its horizontal scroll', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-entity-btn');
    await page.waitForTimeout(300);
    const wrap = await page.evaluate(() => {
      const w = document.querySelector('.table-wrap');
      return { overflowX: getComputedStyle(w).overflowX, scrolls: w.scrollWidth > w.clientWidth };
    });
    assert.equal(wrap.overflowX, 'auto');
    assert.ok(wrap.scrolls, 'the wide grid scrolls sideways inside its card');
    await openTasks(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.table-wrap')).overflowX === 'clip');
    await page.close();
  });

  const scrollerOf = (page) => page.evaluate(() => {
    const wrap = document.querySelector('#main > .table-wrap');
    return wrap.classList.contains('wv-grid-scroll') ? 'wrap' : 'main';
  });
  const scrollTo = (page, where, top) => page.evaluate(({ where, top }) => {
    const box = where === 'wrap' ? document.querySelector('#main > .table-wrap') : document.querySelector('#main');
    box.scrollTo({ top, behavior: 'instant' });
  }, { where, top });
  const rowsBelowFoot = (page) => page.evaluate(() => {
    const probe = document.head.appendChild(document.createElement('style'));
    probe.textContent = '.wv-grid tr.add-entity-row td::after { pointer-events: auto !important; }';
    const wrap = document.querySelector('#main > .table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main');
    const r = box.getBoundingClientRect();
    const seen = Math.min(r.bottom, innerHeight);
    const foot = document.querySelector('.wv-grid tr.add-entity-row > td').getBoundingClientRect();
    const showing = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      const row = hit?.closest?.('tr.entity-row');
      return row ? `#${row.querySelector('.open-link')?.textContent ?? '?'}` : null;
    };
    const out = [];
    for (let y = Math.ceil(foot.bottom) + 1; y < seen - 1; y += 4) {
      const x = foot.left + 12;
      const hit = showing(x, y);
      if (hit) out.push(`${hit} at y=${y}`);
    }
    probe.remove();
    return { foot: foot.toJSON(), seen, rows: [...new Set(out)] };
  });
  const footIsLast = (page) => page.evaluate(() => {
    const tbody = document.querySelector('.wv-grid > tbody');
    const last = tbody.lastElementChild;
    const after = [];
    for (let n = tbody.querySelector('tr.add-entity-row')?.nextElementSibling; n; n = n.nextElementSibling) after.push(n.className || n.tagName);
    return { last: last?.className ?? null, after, feet: tbody.querySelectorAll('tr.add-entity-row').length };
  });
  const select = async (page, n) => {
    const boxes = page.locator('.wv-grid tbody tr.entity-row .sel-box');
    for (let i = 0; i < n; i++) await boxes.nth(i).click({ force: true });
    await page.waitForSelector('.sel-puck');
    await page.waitForFunction((k) => document.querySelectorAll('.wv-grid tbody .sel-box:checked').length === k, n);
  };

  for (const [label, open] of [
    ['a grid that fits its pane', async (page) => { await openTasks(page); return 'main'; }],
    ['a grid wider than its card', async (page) => {
      await page.goto(`${base}/#/table/${broad.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`tr[data-eid="${broadRows[0]}"]`);
      await page.waitForFunction(() => document.querySelector('#main > .table-wrap')?.classList.contains('wv-grid-scroll'));
      return 'wrap';
    }],
  ]) {
    test(`with six rows selected, no row shows below the + New row in ${label} (Issue #986)`, async () => {
      const page = await browser.newPage({ viewport: FIT });
      const where = await open(page);
      assert.equal(await scrollerOf(page), where);
      await select(page, 6);
      for (const top of [0, 1200, 3000]) {
        await scrollTo(page, where, top);
        await page.waitForTimeout(150);
        const seen = await rowsBelowFoot(page);
        assert.deepEqual(seen.rows, [], `scrolled to ${top}: rows show below the foot ${JSON.stringify(seen)}`);
        assert.deepEqual((await footIsLast(page)).after, [], `scrolled to ${top}: the foot is the tbody's last row`);
      }
      await page.close();
    });
  }

  test('the + New row stays the last row of the grid through scrolling, paging, sorting, creating and selecting (Issue #986)', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.goto(`${base}/#/table/${broad.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${broadRows[0]}"]`);
    const check = async (step) => {
      const at = await footIsLast(page);
      assert.equal(at.feet, 1, `${step}: one foot`);
      assert.deepEqual(at.after, [], `${step}: nothing renders after the foot`);
      assert.match(at.last, /add-entity-row/, `${step}: the foot is the last row`);
    };
    await check('first paint');
    const where = await scrollerOf(page);
    for (const top of [400, 2500, 6000, 99999, 0]) {
      await scrollTo(page, where, top);
      await page.waitForTimeout(120);
      await check(`scrolled to ${top}`);
    }
    await page.waitForFunction(() => !document.querySelector('.wv-grid tr.wv-load-more'), null, { timeout: 8000 }).catch(() => {});
    await check('after the second page loads');
    await select(page, 6);
    await check('with a selection open');
    await scrollTo(page, where, 99999);
    await page.waitForTimeout(120);
    await check('selection open, scrolled to the end');
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForFunction(() => document.activeElement?.closest?.('tr.entity-row'), null, { timeout: 5000 });
    await check('after creating a row');
    await page.goto(`${base}/#/table/${ranked.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await check('sorted by Rank');
    for (const top of [3000, 99999]) {
      await scrollTo(page, await scrollerOf(page), top);
      await page.waitForTimeout(120);
      await check(`sorted, scrolled to ${top}`);
    }
    await scrollTo(page, await scrollerOf(page), 0);
    await page.waitForTimeout(120);
    await select(page, 6);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForFunction(() => document.activeElement?.closest?.('tr.entity-row'), null, { timeout: 5000 });
    await check('sorted, after creating a row with a selection open');
    await page.close();
  });

  test('the related-section foot on an entity page stays in the flow', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.goto(`${base}/#/entity/${alpha.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.related-section .add-entity-row td');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.related-section .add-entity-row td')).position), 'static');
    await page.close();
  });
}
