import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone list rows', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Notes', type: 'text' });
  const releases = weave.createTable({ space: 'Development', name: 'Release' });
  const release = weave.createEntity(releases, { name: 'v0.4.84' });
  weave.addRelation(issues.id, { name: 'Fixed in', targetDb: releases.id, cardinality: 'many-to-one', inverseName: 'Fixes' });
  for (let i = 0; i < 120; i++) {
    const name = i % 3 ? `Issue ${i}` : `Issue ${i}: the weave review watcher has not finished a cycle in 150 minutes, so nothing lands`;
    weave.createEntity(issues, { name, values: { Status: 'Open', Severity: ['Low', 'Medium', 'High'][i % 3], Notes: i % 2 ? 'a note' : '', 'Fixed in': i % 2 ? release.id : null } });
  }
  const tasks = weave.createTable({ space: 'Development', name: 'Task' });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (let i = 0; i < 20; i++) weave.createEntity(tasks, { name: `Task ${i}: a name long enough to need a second line on a phone screen`, values: { Severity: 'High' } });
  return { table: `#/table/${issues.id}`, compactId: tasks.id, compact: `#/table/${tasks.id}` };
});

if (s) {
  const { base, browser, table, compact, compactId } = s;
  const open = async ({ width, theme = 'light', density = null } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript(([t, id, d]) => { localStorage.setItem('weave-theme', t); if (d) localStorage.setItem(`weave-grid-density:${id}`, d); }, [theme, compactId, density]);
    await page.goto(`${base}/${density ? compact : table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tbody tr.entity-row');
    return page;
  };
  const list = (page) => page.evaluate(() => {
    const table = document.querySelector('#main .wv-grid');
    const tbody = table.tBodies[0];
    const top0 = tbody.getBoundingClientRect().top;
    const rows = [...tbody.querySelectorAll('tr.entity-row')].map((tr) => {
      const r = tr.getBoundingClientRect();
      const name = tr.querySelector('.list-name');
      const nr = name?.getBoundingClientRect();
      const pid = tr.querySelector('.open-link');
      const chips = [...tr.querySelectorAll('td[data-field] .k')].filter((k) => k.getClientRects().length).map((k) => ({ text: k.textContent.trim(), top: k.getBoundingClientRect().top }));
      return {
        i: Number(tr.dataset.i), offset: Math.round(r.top - top0), height: Math.round(r.height), bottom: r.bottom,
        name: name?.textContent ?? null, nameShown: !!name && name.getClientRects().length > 0, nameTop: nr?.top, nameH: nr?.height,
        lineH: name ? parseFloat(getComputedStyle(name).lineHeight) : 0,
        pidColor: pid ? getComputedStyle(pid).color : null, chips,
      };
    });
    return {
      theme: document.documentElement.dataset.bsTheme,
      token: getComputedStyle(table).getPropertyValue('--wv-row-h').trim(),
      head: table.tHead ? getComputedStyle(table.tHead).display : 'none',
      secondary: getComputedStyle(document.body).getPropertyValue('--tblr-secondary').trim(),
      rows, scrollWidth: document.documentElement.scrollWidth, vw: innerWidth,
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`on a phone the table is a list of 88px rows: muted #id, a two-line name, then value chips (${theme}, Feature #272)`, async () => {
      const page = await open({ theme });
      try {
        const seen = await list(page);
        assert.equal(seen.theme, theme);
        assert.equal(seen.head, 'none', 'the column header is gone');
        assert.equal(seen.token, '88px', 'the phone row height is declared on the grid token');
        assert.ok(seen.scrollWidth <= seen.vw, `no sideways scroll (${seen.scrollWidth})`);
        assert.ok(seen.rows.length >= 6);
        for (const r of seen.rows) {
          assert.equal(r.height, 88, `row ${r.i} is ${r.height}px`);
          assert.ok(r.nameShown, `row ${r.i} shows its name`);
          assert.ok(r.nameH <= 2 * r.lineH + 1, `row ${r.i}'s name takes at most two lines (${r.nameH}px)`);
          assert.ok(r.chips.some((c) => c.text === 'Open'), `row ${r.i} shows its Status chip`);
          assert.ok(r.chips.every((c) => c.top > r.nameTop), `row ${r.i}'s chips sit under its name`);
        }
        assert.ok(seen.rows.some((r) => r.nameH > 1.5 * r.lineH), 'a long name wraps to a second line');
      } finally { await page.close(); }
    });
  }

  test('on a phone list rows follow the windowing token as you scroll (Feature #272)', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = 88 * 60; });
      await page.waitForFunction(() => document.querySelector('#main tbody tr.entity-row[data-i="62"]'));
      await page.waitForTimeout(100);
      const seen = await list(page);
      const first = seen.rows[0];
      assert.ok(first.i > 0, `the window moved (${first.i})`);
      for (const r of seen.rows) assert.equal(r.offset, r.i * 88, `row ${r.i} sits at ${r.offset}px, not ${r.i * 88}px`);
    } finally { await page.close(); }
  });

  test('on a phone compact density gives one-line names in 68px rows (Feature #272)', async () => {
    const page = await open({ density: 'compact' });
    try {
      await page.waitForSelector('#main .wv-grid[data-density="compact"]');
      const seen = await list(page);
      assert.equal(seen.token, '68px');
      for (const r of seen.rows) {
        assert.equal(r.height, 68, `row ${r.i} is ${r.height}px`);
        assert.ok(r.nameH <= r.lineH + 1, `row ${r.i}'s name is one line`);
        assert.ok(r.chips.some((c) => c.text === 'High'), `row ${r.i} still shows its chips`);
      }
    } finally { await page.close(); }
  });

  test('on a phone a tap on a row opens the row and never edits a cell (Feature #272)', async () => {
    const page = await open();
    try {
      const tr = page.locator('#main tbody tr.entity-row').nth(1);
      const id = await tr.getAttribute('data-eid');
      const box = await tr.locator('.list-name').boundingBox();
      await page.mouse.click(box.x + 20, box.y + 8);
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.ok(page.url().includes(`?e=${id}`), 'the tapped row opens');
      const active = await page.evaluate(() => document.activeElement?.closest?.('.wv-grid') ? document.activeElement.tagName : null);
      assert.equal(active, null, 'nothing in the grid took focus for editing');
      await page.click('#dock button[aria-label="Close"]');
      await page.waitForSelector('#dock', { state: 'hidden' });
      const chip = page.locator('#main tbody tr.entity-row').nth(2).locator('td[data-field="Severity"] .k');
      await chip.waitFor();
      await settled(page.locator('#main .table-wrap'));
      const cb = await chip.boundingBox();
      await page.mouse.click(cb.x + 4, cb.y + 4);
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.equal(await page.locator('.picker-pop').count(), 0, 'a tap on a chip opens the row, not the picker');
    } finally { await page.close(); }
  });

  test('on a phone an empty relation takes no room in the chip line (Issue #721)', async () => {
    const page = await open();
    try {
      const seen = await page.evaluate(() => [...document.querySelectorAll('#main tbody tr.entity-row')].slice(0, 6).map((tr) => {
        const cells = [...tr.querySelectorAll(':scope > td[data-field]')];
        const boxes = cells.filter((td) => td.getClientRects().length).map((td) => td.getBoundingClientRect());
        return {
          i: Number(tr.dataset.i),
          cells: cells.map((td) => ({
            field: td.dataset.field,
            ftype: td.dataset.ftype,
            display: getComputedStyle(td).display,
            overflowed: td.classList.contains('list-hide'),
            width: Math.round(td.getBoundingClientRect().width),
            values: td.querySelectorAll('.ms-box > .k:not(.k-more)').length,
          })),
          gaps: boxes.slice(1).map((r, n) => Math.round(r.left - boxes[n].right)),
        };
      }));
      const GAP = 6;
      assert.ok(seen.length >= 6);
      for (const r of seen) {
        const rel = r.cells.find((c) => c.ftype === 'relation');
        assert.ok(rel, `row ${r.i} carries its Fixed in cell`);
        if (rel.values === 0) assert.equal(rel.display, 'none', `row ${r.i} leaves a ${rel.width}px blank where its empty Fixed in sits`);
        else assert.ok(rel.display !== 'none' || rel.overflowed, `row ${r.i} hides a Fixed in value that is not overflowing`);
        for (const g of r.gaps) assert.ok(g <= GAP + 1, `row ${r.i} packs its chips left, found a ${g}px gap`);
      }
      assert.ok(seen.some((r) => r.cells.some((c) => c.ftype === 'relation' && c.values === 0)), 'a row with an empty relation is in the sample');
      assert.ok(seen.some((r) => r.cells.some((c) => c.ftype === 'relation' && c.values > 0)), 'and a row with a filled one');
    } finally { await page.close(); }
  });

  test('on a desktop the grid keeps its header, 44px rows and cell editing (Feature #272)', async () => {
    const page = await open({ width: 1280 });
    try {
      const seen = await list(page);
      assert.notEqual(seen.head, 'none');
      assert.equal(seen.token, '44px');
      for (const r of seen.rows.slice(0, 5)) {
        assert.equal(r.height, 44);
        assert.equal(r.nameShown, false, 'the phone name line stays hidden');
      }
      await page.click('#main tbody tr.entity-row >> nth=0 >> td.name-cell');
      assert.equal(await page.evaluate(() => document.activeElement?.closest?.('td.name-cell') ? document.activeElement.tagName : null), 'INPUT', 'a click on a name cell edits it');
    } finally { await page.close(); }
  });
}
