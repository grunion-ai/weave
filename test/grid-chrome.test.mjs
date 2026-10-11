import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, people, task;

const s = await launch('grid chrome', (weave) => {
  weave.createSpace({ name: 'Product' });
  people = weave.createTable({ space: 'Product', name: 'Person' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'text' });
  const FILLERS = Array.from({ length: 18 }, (_, i) => `Col ${i + 1}`);
  for (const n of FILLERS) weave.addField(tasks, { name: n, type: 'text' });
  weave.addField(tasks, { name: 'Brief', type: 'document' });
  weave.addRelation(tasks, { name: 'Owners', targetDb: people, cardinality: 'many-to-many', inverseName: 'Tasks' });
  weave.addRelation(tasks, { name: 'Lead', targetDb: people, cardinality: 'many-to-one', inverseName: 'Leads' });

  const mia = weave.createEntity(people, { name: 'Mia Okafor' });
  task = weave.createEntity(tasks, {
    name: 'A task whose name is far too long to sit inside one grid column',
    values: {
      Notes: 'A note that also runs past the end of its column and has to be clipped',
      ...Object.fromEntries(FILLERS.map((n) => [n, `${n} carries a value long enough to clip`])),
    },
  });
  weave.link(task.id, 'Owners', [mia.id]);
  weave.updateField(tasks, 'Name', { config: { width: 60 } });
  weave.link(task.id, 'Lead', [mia.id]);
  weave.setDoc(task.id, '# Title\n\n**bold** body\n\n- third line');
  const full = weave.createEntity(tasks, { name: 'Short' });
  weave.setDoc(full.id, '# Written\n\nthis one is not empty', 'Brief');

});
if (s) {
  const { base, browser, weave } = s;
  async function grid(density) {
    const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
    if (density) {
      weave.tableView(`${tasks.id}/${weave.tableView(tasks).views[0].id}`, { density });
    }
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr');
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody td.clipped').length > 0
      || document.querySelectorAll('.wv-grid tbody tr').length > 0);
    return page;
  }

  test('a clipped cell expands on its value’s left edge without covering it', async () => {
    const page = await grid();
    try {
      const off = await page.evaluate(async () => {
        const td = [...document.querySelectorAll('.wv-grid tbody td.clipped')][0];
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const pop = document.querySelector('.cell-pop');
        if (!pop) return null;
        const box = (n) => (n.firstElementChild ?? n).getBoundingClientRect();
        const a = box(td); const b = box(pop);
        const cell = td.getBoundingClientRect(); const p = pop.getBoundingClientRect();
        return { dx: Math.round(b.left - a.left), clear: p.bottom <= cell.top || p.top >= cell.bottom };
      });
      assert.ok(off, 'hovering a clipped cell opens the expansion');
      assert.ok(Math.abs(off.dx) <= 1, `the value keeps its left edge (moved ${off.dx}px)`);
      assert.equal(off.clear, true, 'the copy sits off the cell, never over the value');
    } finally { await page.close(); }
  });

  test('a clipped name keeps its type in the expansion', async () => {
    const page = await grid();
    try {
      const type = await page.evaluate(async () => {
        const td = document.querySelector('.wv-grid tbody td.name-cell.clipped');
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const pop = document.querySelector('.cell-pop');
        if (!pop) return null;
        const read = (n) => {
          const cs = getComputedStyle(n.querySelector('.inline-edit') ?? n);
          return { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily };
        };
        return { cell: read(td), pop: read(pop) };
      });
      assert.ok(type, 'the name cell is clipped and expands');
      assert.deepEqual(type.pop, type.cell, 'same font, same size, same weight');
    } finally { await page.close(); }
  });

  test('a pointer passing through a clipped cell opens nothing', async () => {
    const page = await grid();
    try {
      const flashed = await page.evaluate(async () => {
        const tds = [...document.querySelectorAll('.wv-grid tbody td.clipped')];
        if (!tds.length) return null;
        const wrap = tds[0].closest('.table-wrap');
        for (const td of tds) {
          td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 40));
        }
        wrap.dispatchEvent(new MouseEvent('mouseleave'));
        await new Promise((r) => setTimeout(r, 400));
        return { pop: !!document.querySelector('.cell-pop') };
      });
      assert.ok(flashed, 'there are clipped cells to cross');
      assert.equal(flashed.pop, false, 'nothing opened for a pointer that never rested');
    } finally { await page.close(); }
  });

  test('a cell that starts overflowing gets its marker without a redraw', async () => {
    const page = await grid();
    try {
      await page.setViewportSize({ width: 640, height: 900 });
      await page.waitForFunction(() => {
        const tds = [...document.querySelectorAll('.wv-grid tbody td[data-field]')];
        const wide = (n) => n.scrollWidth > n.clientWidth + 1;
        const over = tds.filter((t) => { const b = t.querySelector(':scope > .wv-cb'); return b && (wide(b) || [...b.children].some(wide)); });
        return over.length > 0 && over.every((t) => t.classList.contains('clipped'));
      }, null, { timeout: 3000 });
    } finally { await page.close(); }
  });

  for (const density of ['comfortable', 'compact']) {
    test(`an empty document chip does not grow a ${density} row`, async () => {
      const page = await grid(density);
      try {
        const h = await page.$$eval('.wv-grid tbody tr', (rows) => rows
          .filter((r) => r.querySelector('td .doc-chip'))
          .map((r) => Math.round(r.getBoundingClientRect().height)));
        assert.ok(h.length >= 2, 'two rows to compare');
        assert.equal(new Set(h).size, 1, `every row is the same height (${h.join(', ')})`);
        const want = density === 'compact' ? 32 : 44;
        assert.equal(h[0], want, `a ${density} row is ${want}px (${h[0]})`);
      } finally { await page.close(); }
    });
  }

  test('the description preview shows its marks, not its syntax', async () => {
    const page = await grid();
    try {
      const seen = await page.evaluate(() => {
        const box = document.querySelector('.wv-grid tbody .doc-preview');
        if (!box) return null;
        return { text: box.textContent, strong: !!box.querySelector('strong') };
      });
      assert.ok(seen, 'the description has a cell of its own');
      assert.ok(!seen.text.includes('#'), `a heading arrives as its words (${seen.text})`);
      assert.ok(!seen.text.includes('**'), 'and bold as bold');
      assert.ok(seen.strong, 'the mark is really a <strong>');
    } finally { await page.close(); }
  });

  test('hovering a description shows the lines the row had no room for', async () => {
    const page = await grid();
    try {
      const lines = await page.evaluate(async () => {
        const td = document.querySelector('.wv-grid tbody td:has(> .wv-cb > .doc-preview)');
        if (!td) return null;
        const visible = (n) => [...n.querySelectorAll('.doc-preview-line')]
          .filter((l) => getComputedStyle(l).display !== 'none').length;
        const inCell = visible(td);
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        const pop = document.querySelector('.cell-pop');
        return pop ? { inCell, inPop: visible(pop) } : { inCell, inPop: 0 };
      });
      assert.ok(lines, 'the description cell is there to hover');
      assert.equal(lines.inCell, 1, 'the row shows one line, whatever the document holds');
      assert.ok(lines.inPop > lines.inCell, `the expansion shows more (${lines.inPop} vs ${lines.inCell})`);
    } finally { await page.close(); }
  });

  test('a description reads at full strength, not dimmed like a computed cell', async () => {
    const page = await grid();
    try {
      const look = await page.evaluate(() => {
        const td = document.querySelector('.wv-grid tbody td:has(> .wv-cb > .doc-preview)');
        const name = document.querySelector('.wv-grid tbody td.name-cell');
        return {
          computed: td.classList.contains('cell-computed'),
          color: getComputedStyle(td.querySelector('.doc-preview')).color,
          nameColor: getComputedStyle(name.querySelector('.text-dressed') ?? name).color,
          cursor: getComputedStyle(td.querySelector('.doc-preview')).cursor,
        };
      });
      assert.equal(look.computed, false, 'the description cell is not tagged computed');
      assert.equal(look.color, look.nameColor, 'it is as legible as the name beside it');
      assert.equal(look.cursor, 'pointer', 'and it advertises that clicking does something');
    } finally { await page.close(); }
  });

  test('an empty description is blank at rest and a dashed invitation on focus', async () => {
    const page = await grid();
    try {
      const look = () => page.evaluate(() => {
        const box = [...document.querySelectorAll('.wv-grid tbody .doc-preview.is-empty')][0];
        if (!box) return null;
        const cs = getComputedStyle(box.querySelector('.doc-preview-line'));
        return { style: cs.borderTopStyle, opacity: getComputedStyle(box).opacity, framework: box.classList.contains('empty') };
      });
      const rest = await look();
      assert.ok(rest, 'an unwritten description still has its box to click');
      assert.equal(rest.opacity, '0', 'nothing shows at rest');
      assert.equal(rest.framework, false, 'never Tabler’s global `.empty`');
      await page.evaluate(() => document.querySelector('.wv-grid tbody .doc-preview.is-empty').closest('td').focus());
      const on = await look();
      assert.equal(on.style, 'dashed', 'dashed says "write here" on the focused cell');
      assert.equal(on.opacity, '1', 'at full strength, not dimmed');
    } finally { await page.close(); }
  });

  test('the empty-document chip does not wear a framework class name', async () => {
    const page = await grid();
    try {
      const bad = await page.$$eval('.doc-chip, .k-attach', (ns) => ns
        .filter((n) => n.classList.contains('empty')).length);
      assert.equal(bad, 0, 'the empty state is scoped to weave, not the `empty` global');
    } finally { await page.close(); }
  });

  test('clicking the right edge of a relation chip opens that entity', async () => {
    const page = await grid();
    try {
      const link = page.locator('.wv-grid tbody .k-rel > a').first();
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await page.waitForSelector('#dock:not([hidden]) .name-edit', { timeout: 3000 });
      assert.match(page.url(), /#\/table\//, 'the arrow docks; the dock is not a navigation');
    } finally { await page.close(); }
  });

  test('a relation chip in the grid carries no ×', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.wv-grid tbody .k-rel .x').count(), 0,
        'unlinking is an edit; the grid is a record');
      assert.ok(await page.locator('.wv-grid tbody .ms-box > .btn').count() > 0,
        'and + link is still how the cell is edited');
    } finally { await page.close(); }
  });

  test('the entity page keeps the × on its relation chips', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.entity-fields .fieldrow');
      assert.ok(await page.locator('.entity-fields .k-rel .x').count() > 0,
        'the record’s own page is where a link is taken off');
      await page.waitForSelector('.unlink-btn');
      assert.ok(await page.locator('.unlink-btn').count() > 0, 'and a related grid unlinks by its own button');
    } finally { await page.close(); }
  });
}
