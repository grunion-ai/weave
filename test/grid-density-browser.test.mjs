import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 600;
const ROW = { compact: 32, comfortable: 44, spacious: 72 };
const LABEL = { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let narrow, wide, tall, every, everyViews, legacy;
const s = await launch('the density flip', (weave) => {
  weave.createSpace({ name: 'Quality' });
  narrow = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(narrow, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  wide = weave.createTable({ space: 'Quality', name: 'Run' });
  const notes = {};
  for (let k = 0; k < 10; k++) { weave.addField(wide, { name: `Note ${k}`, type: 'text' }); notes[`Note ${k}`] = `note ${k} value`; }
  for (let i = 0; i < N; i++) {
    const name = `case ${String(i).padStart(4, '0')}`;
    weave.createEntity(narrow, { name, values: { Status: i % 2 ? 'pass' : 'fail' } });
    weave.createEntity(wide, { name, values: notes });
  }
  tall = weave.createTable({ space: 'Quality', name: 'Ledger' });
  for (let i = 0; i < N; i++) {
    weave.createEntity(tall, {
      name: `t${String(i).padStart(4, '0')}`,
      values: { Description: i % 3 === 0 ? 'A body with `code` in it and a few more words after' : '' },
    });
  }

  const people = weave.createTable({ space: 'Quality', name: 'People' });
  const folks = Array.from({ length: 12 }, (_, k) => weave.createEntity(people, { name: `Person number ${k} with a long name` }));
  every = weave.createTable({ space: 'Quality', name: 'Every' });
  const TAGS = Array.from({ length: 12 }, (_, k) => `tag-${k}-label`);
  const add = (name, type, config) => weave.addField(every, { name, type, ...(config ? { config } : {}) });
  add('Text', 'text');
  add('Count', 'number');
  add('Stars', 'rating');
  add('Due', 'date');
  add('Span', 'daterange');
  add('Done', 'checkbox');
  add('On', 'toggle');
  add('Site', 'url');
  add('Mail', 'email');
  add('Kind', 'select', { options: ['A select option with a long label', 'short'] });
  add('Tags', 'multiselect', { options: TAGS });
  add('Stage', 'workflow', { states: [{ name: 'Open', category: 'not-started' }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] });
  weave.addRelation(every, { name: 'Owners', targetDb: people, cardinality: 'many-to-many', inverseName: 'Owned' });
  add('Def', 'field');
  add('Secret', 'key');
  add('Files', 'attachments');
  add('Twice', 'formula', { expression: 'Count * 2' });
  add('Owner names', 'lookup', { relationField: 'Owners', targetField: 'Name' });
  add('Brief', 'document');
  weave.updateField(every, 'Card', { config: { shape: 'card', link: true, state: true, description: 'medium', fields: ['Stage', 'Due'] } });
  const MD = `# A heading in the description\n\n${'A **long** paragraph with `code`, a [link](https://example.com) and _marks_ that runs on. '.repeat(5)}\n\n- a list item\n- another list item\n\n> a quote`.slice(0, 600);
  for (let i = 0; i < 12; i++) {
    const e = weave.createEntity(every, {
      name: `Row ${i}: a name long enough to run past its column and wrap onto a second and a third line in a wide cell`,
      values: {
        Text: 'A text value with **marks** and `code` that is much longer than its column can hold at any density',
        Count: 1234567, Stars: 4, Due: '2026-09-27', Span: { start: '2026-09-01', end: '2026-09-30' },
        Done: true, On: true, Site: 'https://example.com/a/very/long/path/that/keeps/going/and/going', Mail: 'someone.with.a.long.address@example.com',
        Kind: 'A select option with a long label', Tags: TAGS, Stage: 'Doing', Def: { type: 'text', config: {} }, Secret: 'stripe-live',
      },
    });
    weave.link(e.id, 'Owners', folks.map((p) => p.id));
    weave.setDoc(e.id, MD);
    weave.setDoc(e.id, MD, 'Brief');
    weave.attachToField(e.id, 'Files', { name: 'shot.png', mime: 'image/png', bytes: PNG });
  }
  const first = weave.tableView(every).views[0].name;
  weave.tableView(`${every.id}/${first}`, { show: ['Card'] });
  weave.tableView(`${every.id}/Second`, { from: first });
  everyViews = weave.tableView(every).views;
  legacy = weave.createTable({ space: 'Quality', name: 'Legacy' });
  for (let i = 0; i < 5; i++) weave.createEntity(legacy, { name: `legacy ${i}` });
});

if (s) {
  const { base, browser } = s;
  const COMPACT = '.seg-opt[title="Short rows, for scanning"]';
  const ROOMY = '.seg-opt[title="Roomy rows, for reading"]';

  const open = async (db) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(300);
    return page;
  };
  const view = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const table = document.querySelector('.wv-grid');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : null;
    const edge = table.querySelector('thead th').getBoundingClientRect().bottom;
    let top = null;
    for (const tr of table.querySelectorAll('tbody tr[data-i]')) {
      if (tr.getBoundingClientRect().bottom > edge + 1) { top = Number(tr.dataset.i); break; }
    }
    return {
      scroller: box ? 'wrap' : 'page',
      top,
      scrollTop: Math.round((box ?? document.querySelector('#main')).scrollTop),
      rowH: Math.round(table.querySelector('tbody tr.entity-row').getBoundingClientRect().height * 10) / 10,
      density: table.dataset.density,
    };
  });
  const scrollTo = async (page, top) => {
    await page.evaluate((t) => {
      const wrap = document.querySelector('.table-wrap');
      (wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main')).scrollTo({ top: t, behavior: 'instant' });
    }, top);
    await page.waitForTimeout(400);
  };
  const settle = (page) => page.waitForTimeout(400);

  test('a density flip on a wide grid leaves the reader on the same row, both ways', async () => {
    const page = await open(wide);
    try {
      await scrollTo(page, 10800);
      const before = await view(page);
      assert.equal(before.scroller, 'wrap', 'a grid wider than its card scrolls in its own box');
      assert.ok(before.top > 100, `the reader is deep in the table: ${JSON.stringify(before)}`);

      await page.click('.table-density-btn');
      await page.click(COMPACT);
      await settle(page);
      const compact = await view(page);
      assert.equal(compact.density, 'compact');
      assert.ok(compact.rowH < before.rowH - 4, `compact rows are shorter: ${before.rowH} to ${compact.rowH}`);
      assert.ok(compact.scrollTop > 0, `the reader is not back at the top: ${JSON.stringify(compact)}`);
      assert.equal(compact.top, before.top, `the same row heads the view: ${JSON.stringify({ before, compact })}`);

      await page.click('.table-density-btn');
      await page.click(ROOMY);
      await settle(page);
      const roomy = await view(page);
      assert.ok(roomy.rowH > compact.rowH + 4, 'comfortable rows are taller again');
      assert.equal(roomy.top, before.top, `and the flip back carries it too: ${JSON.stringify({ before, roomy })}`);
    } finally { await page.close(); }
  });

  test('a density flip on a page-scrolling grid leaves the reader on the same row', async () => {
    const page = await open(narrow);
    try {
      await scrollTo(page, 10800);
      const before = await view(page);
      assert.equal(before.scroller, 'page', 'a grid that fits its card scrolls the page');
      assert.ok(before.top > 100, `the reader is deep in the table: ${JSON.stringify(before)}`);

      await page.evaluate((sel) => { document.querySelector('.table-density-btn').click(); document.querySelector(sel).click(); }, COMPACT);
      await settle(page);
      const compact = await view(page);
      assert.equal(compact.density, 'compact');
      assert.ok(compact.rowH < before.rowH - 4, `compact rows are shorter: ${before.rowH} to ${compact.rowH}`);
      assert.ok(compact.scrollTop > 0, `the reader is not back at the top: ${JSON.stringify(compact)}`);
      assert.equal(compact.top, before.top, `the same row heads the view: ${JSON.stringify({ before, compact })}`);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`a density flip keeps the row heading a page-scrolled grid of uneven rows, both ways (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
      try {
        await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.waitForTimeout(300);
        await scrollTo(page, 10800);
        const pick = (sel) => page.evaluate((q) => { document.querySelector('.table-density-btn').click(); document.querySelector(q).click(); }, sel);
        const roomy = await view(page);
        assert.equal(roomy.scroller, 'page', 'a grid that fits its card scrolls the page');
        assert.ok(roomy.top > 100, `the reader stands part way down: ${JSON.stringify(roomy)}`);

        await pick(COMPACT);
        await settle(page);
        const compact = await view(page);
        assert.ok(compact.rowH < roomy.rowH - 4, `the flip took: ${JSON.stringify({ roomy, compact })}`);
        assert.equal(compact.top, roomy.top, `Comfortable → Compact keeps the row heading the view: ${JSON.stringify({ roomy, compact })}`);

        await pick(ROOMY);
        await settle(page);
        const back = await view(page);
        assert.equal(back.top, roomy.top, `Compact → Comfortable keeps it too: ${JSON.stringify({ roomy, compact, back })}`);
      } finally { await page.close(); }
    });
  }

  test('picking a density returns focus to its dropdown button', async () => {
    const page = await open(wide);
    try {
      await page.click('.table-density-btn');
      await page.click(COMPACT);
      await settle(page);
      const focused = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? null,
        density: document.activeElement?.classList.contains('table-density-btn') ?? false,
        text: document.activeElement?.textContent?.trim() ?? null,
      }));
      assert.equal(focused.tag, 'BUTTON');
      assert.equal(focused.density, true, 'the closed dropdown returns focus to its trigger');
      assert.match(focused.text, /Compact/, 'the trigger names the selected density');
    } finally { await page.close(); }
  });

  const pickDensity = async (page, d) => {
    await page.evaluate((label) => {
      document.querySelector('.table-density-btn').click();
      const opt = [...document.querySelectorAll('.table-density-popover .seg-opt')].find((b) => b.textContent.trim() === label);
      if (!opt) throw new Error(`no ${label} option`);
      opt.click();
    }, LABEL[d]);
    await settle(page);
  };
  const openAt = async (hash, { theme = 'light', width = 1600 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'load' });
    if (theme !== 'light') await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(300);
    return page;
  };
  const viewUrl = (db, v) => `#/table/${db.id}/view/${v.id}`;
  const measure = (page) => page.evaluate(() => {
    const table = document.querySelector('.wv-grid');
    const rows = [...table.querySelectorAll('tbody tr.entity-row')];
    return {
      density: table.dataset.density,
      heights: rows.map((r) => Math.round(r.getBoundingClientRect().height * 100) / 100),
      widths: [...table.querySelectorAll('thead tr:first-child > th')].map((th) => Math.round(th.getBoundingClientRect().width * 100) / 100),
      fonts: [...rows[0].querySelectorAll('td, td *')].map((n) => getComputedStyle(n).fontSize),
      tallest: Object.fromEntries([...rows[0].querySelectorAll('td[data-ftype]')].map((td) => [td.dataset.ftype, Math.round(td.getBoundingClientRect().height)])),
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`every painted row is exactly its density's height, whatever its cells hold (${theme})`, async () => {
      const page = await openAt(viewUrl(every, everyViews[0]), { theme });
      try {
        for (const d of ['compact', 'spacious', 'comfortable']) {
          await pickDensity(page, d);
          const m = await measure(page);
          assert.equal(m.density, d);
          assert.ok(m.heights.length >= 12, `the rows painted: ${m.heights.length}`);
          const off = m.heights.filter((h) => h !== ROW[d]);
          assert.deepEqual(off, [], `${d}: every row is ${ROW[d]}px (${[...new Set(m.heights)].join(', ')}; cells ${JSON.stringify(m.tallest)})`);
        }
      } finally { await page.close(); }
    });
  }

  test('the + New row is a row: a data row height at every density, still the sticky foot', async () => {
    const page = await openAt(viewUrl(every, everyViews[0]));
    try {
      for (const d of ['compact', 'comfortable', 'spacious']) {
        await pickDensity(page, d);
        const m = await page.evaluate(() => {
          const table = document.querySelector('.wv-grid');
          const td = table.querySelector('tbody tr.add-entity-row > td');
          const btn = td.querySelector('.add-entity-btn');
          const cs = getComputedStyle(td);
          const h = (n) => Math.round(n.getBoundingClientRect().height * 100) / 100;
          return {
            density: table.dataset.density,
            row: h(table.querySelector('tbody tr.entity-row')),
            add: h(td.closest('tr')),
            cell: h(td),
            btn: h(btn),
            position: cs.position,
            bottom: cs.bottom,
          };
        });
        assert.equal(m.density, d);
        assert.equal(m.cell, ROW[d], `${d}: the + New cell is ${ROW[d]}px, not ${m.cell}px`);
        assert.equal(m.add, m.row, `${d}: the + New row and a data row are the same height (${m.add} against ${m.row})`);
        assert.equal(m.btn, m.cell, `${d}: the button fills the row (${m.btn} of ${m.cell})`);
        assert.equal(m.position, 'sticky', `${d}: the foot stays sticky (Feature #196)`);
        assert.equal(m.bottom, '0px', `${d}: the foot stays pinned to the bottom (Feature #196)`);
      }
      await pickDensity(page, 'comfortable');
    } finally { await page.close(); }
  });

  test('density moves the row height only: the same font sizes and column widths at all three', async () => {
    const page = await openAt(viewUrl(every, everyViews[0]));
    try {
      const seen = {};
      for (const d of ['comfortable', 'compact', 'spacious']) { await pickDensity(page, d); seen[d] = await measure(page); }
      for (const d of ['compact', 'spacious']) {
        assert.deepEqual(seen[d].widths, seen.comfortable.widths, `${d}: every column keeps its width`);
        assert.deepEqual(seen[d].fonts, seen.comfortable.fonts, `${d}: every element keeps its font size`);
      }
      await pickDensity(page, 'comfortable');
    } finally { await page.close(); }
  });

  test('a multi-value cell shows whole chips inside its box and counts the rest', async () => {
    const page = await openAt(viewUrl(every, everyViews[0]));
    try {
      for (const d of ['compact', 'comfortable', 'spacious']) {
        await pickDensity(page, d);
        const cells = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row td .ms-box')].map((box) => {
          const cb = box.closest('.wv-cb');
          if (!cb) return { noBox: true };
          const c = cb.getBoundingClientRect();
          const chips = [...box.children].filter((n) => n.matches('.k:not(.k-more):not(.k-add), .mention-wrap'));
          const shown = chips.filter((n) => n.getClientRects().length);
          const more = box.querySelector('.k-more');
          const counted = more && more.getClientRects().length ? Number(more.textContent.replace(/\D/g, '')) : 0;
          const out = [...shown, ...(more && more.getClientRects().length ? [more] : [])].filter((n) => {
            const r = n.getBoundingClientRect();
            return r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5;
          }).map((n) => n.textContent);
          return { field: box.closest('td').dataset.field, total: chips.length, shown: shown.length, counted, out };
        }));
        assert.ok(cells.length >= 24, `the Tags and Owners cells painted: ${cells.length}`);
        for (const c of cells) {
          assert.ok(!c.noBox, `${d}: the chips sit in the cell's clip box`);
          assert.deepEqual(c.out, [], `${d}: no chip crosses its cell box (${c.field})`);
          assert.equal(c.total - c.shown, c.counted, `${d}: the +N counts exactly the chips not shown (${JSON.stringify(c)})`);
          assert.ok(c.shown >= 1 && c.counted > 0, `${d}: twelve chips never fit, and at least one shows (${JSON.stringify(c)})`);
        }
      }
      await pickDensity(page, 'comfortable');
    } finally { await page.close(); }
  });

  test('density is saved in the view: it survives a reload, and a second view keeps its own', async () => {
    const [one, two] = everyViews;
    const page = await openAt(viewUrl(every, one));
    const readView = (v) => page.evaluate(async ([t, id]) => (await fetch(`/api/tables/${t}/views/${id}`)).json(), [every.id, v.id]);
    try {
      await pickDensity(page, 'compact');
      assert.equal((await readView(one)).density, 'compact', 'the pick autosaved to the live view');
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assert.equal(await page.evaluate(() => document.querySelector('.wv-grid').dataset.density), 'compact', 'a reload keeps it');
      await page.goto(`${base}/${viewUrl(every, two)}`);
      await page.waitForFunction((id) => location.hash.endsWith(id) && document.querySelector('.wv-grid tbody tr.entity-row'), two.id);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.querySelector('.wv-grid').dataset.density), 'comfortable', 'the second view is still Comfortable');
      await pickDensity(page, 'spacious');
      await page.goto(`${base}/${viewUrl(every, one)}`);
      await page.waitForFunction((id) => location.hash.endsWith(id) && document.querySelector('.wv-grid')?.dataset.density === 'compact', one.id, { timeout: 5000 });
      assert.equal((await readView(two)).density, 'spacious', 'and the second keeps its own');
      assert.match(await page.textContent('.table-density-btn'), /Compact/, 'the toolbar names the view\'s density');
    } finally {
      await page.evaluate(async ([t, a, b]) => {
        for (const id of [a, b]) await fetch(`/api/tables/${t}/views/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"density":"comfortable"}' });
      }, [every.id, one.id, two.id]);
      await page.close();
    }
  });

  test('the old per-browser density is read once into a view that has none, and the key retires', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const key = `weave-grid-density:${legacy.id}`;
    try {
      await page.goto(`${base}/#/`, { waitUntil: 'load' });
      await page.evaluate((k) => localStorage.setItem(k, 'compact'), key);
      await page.goto(`${base}/#/table/${legacy.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.waitForFunction(() => document.querySelector('.wv-grid').dataset.density === 'compact', null, { timeout: 5000 });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), null, 'the key is removed');
      const v = await page.evaluate(async (t) => (await (await fetch(`/api/tables/${t}/views`)).json()).views[0], legacy.id);
      assert.equal(v.density, 'compact', 'and the view carries it');
    } finally { await page.close(); }
  });

  test('a flip into and out of Spacious at row 400 of 600 keeps the row heading the view', async () => {
    const page = await open(narrow);
    try {
      await pickDensity(page, 'comfortable');
      await scrollTo(page, 400 * ROW.comfortable);
      const before = await view(page);
      assert.ok(Math.abs(before.top - 400) <= 3, `the reader stands at row 400: ${JSON.stringify(before)}`);
      await pickDensity(page, 'spacious');
      const tallRows = await view(page);
      assert.equal(tallRows.rowH, ROW.spacious);
      assert.equal(tallRows.top, before.top, `Comfortable → Spacious keeps the row: ${JSON.stringify({ before, tallRows })}`);
      await pickDensity(page, 'comfortable');
      const back = await view(page);
      assert.equal(back.rowH, ROW.comfortable);
      assert.equal(back.top, before.top, `Spacious → Comfortable keeps it too: ${JSON.stringify({ before, tallRows, back })}`);
    } finally { await page.close(); }
  });
}
