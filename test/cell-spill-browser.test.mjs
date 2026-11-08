import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = (i) => `Row ${i}: a name long enough that the grid column has to clip it before the end`;
const SQUIRREL = 'Design a weekly squirrel digest run it from net.weave workflows';
let tasks, squirrel;
const s = await launch('cell spill', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'text' });
  for (const n of ['Owner', 'Stage', 'Tail']) weave.addField(tasks, { name: n, type: 'text' });
  weave.updateField(tasks, 'Name', { config: { width: 150 } });
  squirrel = weave.createEntity(tasks, { name: SQUIRREL, values: { Notes: 'short', Owner: 'Kyle', Stage: 'Open', Tail: LONG(0) } });
  for (let i = 1; i <= 9; i++) weave.createEntity(tasks, { name: LONG(i), values: { Notes: LONG(i), Owner: 'Mia', Stage: 'Open', Tail: LONG(i) } });
});

if (s) {
  const { base, browser } = s;
  async function grid({ theme, width = 1400 } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody td.name-cell.clipped');
    return page;
  }
  async function tag(page, n, field = null) {
    const ok = await page.evaluate(([n, field]) => {
      const pick = field ? `td[data-field="${field}"].clipped` : 'td.name-cell.clipped';
      const rows = [...document.querySelectorAll('.wv-grid tbody tr')].filter((r) => r.querySelector(pick));
      const td = rows[n]?.querySelector(pick);
      document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'));
      if (!td) return false;
      td.setAttribute('data-t', 'cell');
      return true;
    }, [n, field]);
    assert.ok(ok, `row ${n} has a clipped ${field ?? 'name'} to hover`);
    return page.locator('[data-t="cell"]');
  }
  const gridEdge = () => {
    const td = document.querySelector('[data-t="cell"]');
    const wrap = td.closest('.table-wrap');
    const w = wrap.getBoundingClientRect();
    return Math.min(w.left + wrap.clientLeft + wrap.clientWidth, td.closest('.wv-grid').getBoundingClientRect().right);
  };
  async function readPop(page) {
    return page.evaluate((edgeSrc) => {
      const edge = new Function(`return (${edgeSrc})()`)();
      const td = document.querySelector('[data-t="cell"]');
      const pop = document.querySelector('.cell-pop');
      if (!pop) return { pop: false };
      const r = td.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const text = (n) => {
        const lead = n.querySelector('.inline-edit') ?? n;
        return lead.getBoundingClientRect();
      };
      const cs = getComputedStyle(pop);
      const read = (n) => {
        const c = getComputedStyle(n.querySelector('.inline-edit') ?? n);
        return { size: c.fontSize, weight: c.fontWeight, family: c.fontFamily };
      };
      return {
        pop: true,
        cell: { top: r.top, left: r.left, width: r.width, height: r.height },
        box: { top: p.top, left: p.left, right: p.right, width: p.width, height: p.height },
        edge,
        dx: text(pop).left - text(td).left,
        dy: (text(pop).top + text(pop).height / 2) - (text(td).top + text(td).height / 2),
        lines: Math.round((p.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight)),
        wrap: cs.whiteSpace,
        cut: pop.scrollWidth > pop.clientWidth + 1,
        mask: cs.maskImage || cs.webkitMaskImage || 'none',
        type: { cell: read(td), pop: read(pop) },
        text: pop.textContent,
      };
    }, gridEdge.toString());
  }
  async function hoverAndRead(page, cell) {
    await cell.hover({ position: { x: 30, y: 10 } });
    await page.waitForSelector('.cell-pop', { timeout: 3000 }).catch(() => {});
    return readPop(page);
  }

  {
    const theme = 'light';
    test(`a clipped name spills right from its own top-left edge on one line (${theme})`, async () => {
      const page = await grid({ theme });
      try {
        const cell = await tag(page, 5);
        const got = await hoverAndRead(page, cell);
        assert.equal(got.pop, true, 'hovering opens the spill');
        assert.ok(Math.abs(got.box.top - got.cell.top) <= 1, `top on the cell's top (${got.box.top} vs ${got.cell.top})`);
        assert.ok(Math.abs(got.box.left - got.cell.left) <= 1, `left on the cell's left (${got.box.left} vs ${got.cell.left})`);
        assert.ok(Math.abs(got.box.height - got.cell.height) <= 1, `the cell's own height (${got.box.height} vs ${got.cell.height})`);
        assert.ok(Math.abs(got.dx) <= 1, `the value keeps its left edge (moved ${got.dx}px)`);
        assert.ok(Math.abs(got.dy) <= 1, `and its line (moved ${got.dy}px)`);
        assert.equal(got.wrap, 'nowrap', 'one line, never wrapped');
        assert.equal(got.lines, 1, 'a single line tall');
        assert.ok(got.box.width > got.cell.width + 20, `it runs right over the neighbours (${got.box.width} vs ${got.cell.width})`);
        assert.ok(got.box.right <= got.edge + 1, `and stops at the grid's right edge (${got.box.right} vs ${got.edge})`);
        assert.deepEqual(got.type.pop, got.type.cell, 'same font, size and weight');
        assert.ok(got.text.includes('before the end'), 'it holds the whole value');
        assert.equal(got.cut, false, 'nothing is cut when the value fits before the edge');
      } finally { await page.close(); }
    });
  }

  test('the first row spills in place too, never above or below it', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 0);
      const got = await hoverAndRead(page, cell);
      assert.equal(got.pop, true);
      assert.ok(Math.abs(got.box.top - got.cell.top) <= 1, `on the row (${got.box.top} vs ${got.cell.top})`);
    } finally { await page.close(); }
  });

  test('a spill longer than the room left stops at the grid edge and fades', async () => {
    const page = await grid({ width: 900 });
    try {
      const cell = await tag(page, 2, 'Tail');
      const got = await hoverAndRead(page, cell);
      assert.equal(got.pop, true, 'the last column spills too');
      assert.ok(Math.abs(got.box.right - got.edge) <= 1, `the spill ends on the grid edge (${got.box.right} vs ${got.edge})`);
      assert.equal(got.cut, true, 'the rest of the value is clipped');
      assert.notEqual(got.mask, 'none', 'with a fade, not a hard cut');
    } finally { await page.close(); }
  });

  test('the spill waits 400 ms of rest: none at 300 ms, up by 500 ms', async () => {
    const page = await grid();
    try {
      await tag(page, 4);
      const seen = await page.evaluate(async () => {
        const td = document.querySelector('[data-t="cell"]');
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const at = (ms) => new Promise((r) => setTimeout(() => r(!!document.querySelector('.cell-pop')), ms));
        const [early, late] = await Promise.all([at(300), at(500)]);
        return { early, late };
      });
      assert.equal(seen.early, false, 'nothing at 300 ms');
      assert.equal(seen.late, true, 'the spill by 500 ms');
    } finally { await page.close(); }
  });

  test('clicking into a cell takes the spill down and keeps it down while editing', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 5);
      const opened = await hoverAndRead(page, cell);
      assert.equal(opened.pop, true, 'the spill is up before the click');
      await page.mouse.down();
      assert.equal(await page.locator('.cell-pop').count(), 0, 'mousedown takes it down');
      await page.mouse.up();
      await cell.hover({ position: { x: 60, y: 12 } });
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({
        pop: document.querySelectorAll('.cell-pop').length,
        focusIn: document.querySelector('[data-t="cell"]').contains(document.activeElement),
      }));
      assert.equal(state.focusIn, true, 'the click put focus in the cell');
      assert.equal(state.pop, 0, 'no copy opens over a cell being edited');
    } finally { await page.close(); }
  });

  test('focus moving into the grid takes the spill down', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 5);
      assert.equal((await hoverAndRead(page, cell)).pop, true, 'the spill is up');
      await page.evaluate(() => {
        const other = [...document.querySelectorAll('.wv-grid tbody td[data-field="Owner"] .text-dressed')][2];
        other.focus();
      });
      assert.equal(await page.locator('.cell-pop').count(), 0, 'focusin inside the grid hides it');
    } finally { await page.close(); }
  });

  const readEditor = (page) => page.evaluate((edgeSrc) => {
    const edge = new Function(`return (${edgeSrc})()`)();
    const td = document.querySelector('[data-t="cell"]');
    const a = document.activeElement;
    const r = td.getBoundingClientRect();
    const e = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return {
      tag: a.tagName, inCell: td.contains(a), value: a.value,
      cell: { top: r.top, left: r.left, width: r.width, height: r.height },
      box: { top: e.top, left: e.left, right: e.right, width: e.width, height: e.height },
      edge, scrolls: a.scrollHeight > a.clientHeight + 1,
      lines: Math.round((a.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight)),
      caret: [a.selectionStart, a.selectionEnd],
      textLeft: e.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    };
  }, gridEdge.toString());

  test('clicking a clipped name opens a textarea on the cell that spills, wraps and grows', async () => {
    const page = await grid({ width: 640 });
    try {
      const cell = await tag(page, 3);
      const rest = await page.evaluate(() => {
        const i = document.querySelector('[data-t="cell"] .text-dressed');
        const r = i.getBoundingClientRect();
        const cs = getComputedStyle(i);
        return { left: r.left, top: r.top, textLeft: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) };
      });
      await cell.click({ position: { x: 30, y: 10 } });
      const got = await readEditor(page);
      assert.equal(got.tag, 'TEXTAREA', 'the editor is a textarea, so it can wrap');
      assert.equal(got.inCell, true, 'and it lives in the cell, so the cell keys still apply');
      assert.ok(Math.abs(got.box.top - (rest.top - 4)) <= 1, `anchored where the roomy editor opens, 4px above the value (${got.box.top} vs ${rest.top})`);
      assert.ok(Math.abs(got.box.left - (rest.left - 4)) <= 1, `and 4px left of it (${got.box.left} vs ${rest.left})`);
      assert.ok(Math.abs(got.textLeft - rest.textLeft) <= 1, `the value does not move (${got.textLeft} vs ${rest.textLeft})`);
      assert.ok(got.box.left >= got.cell.left && got.box.top >= got.cell.top, 'inside the cell, from its own top-left corner');
      assert.ok(got.box.width > got.cell.width + 20, `wider than the cell (${got.box.width} vs ${got.cell.width})`);
      assert.ok(Math.abs(got.box.right - got.edge) <= 1, `capped at the grid edge (${got.box.right} vs ${got.edge})`);
      assert.ok(got.lines >= 2, `the rest wraps downward (${got.lines} lines)`);
      assert.ok(got.box.height > got.cell.height, `so it grows past the row (${got.box.height} vs ${got.cell.height})`);
      assert.equal(got.scrolls, false, 'it is as tall as its text, nothing scrolls inside');
      const before = got.box.height;
      await page.keyboard.press('End');
      await page.keyboard.type(' and then a long tail of extra words so the value needs another line in the box');
      const grown = await readEditor(page);
      assert.ok(grown.box.height > before, `typing grows it (${grown.box.height} vs ${before})`);
      assert.equal(grown.scrolls, false, 'still nothing hidden');
    } finally { await page.close(); }
  });

  test('a short edit stays as wide as its text, not the whole grid', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 3);
      await cell.click({ position: { x: 30, y: 10 } });
      const got = await readEditor(page);
      assert.equal(got.tag, 'TEXTAREA');
      assert.equal(got.lines, 1, 'the value fits on one line before the edge');
      assert.ok(got.box.right < got.edge - 40, `so it ends near its text (${got.box.right} vs edge ${got.edge})`);
      assert.ok(got.box.width > got.cell.width, 'but past the cell');
    } finally { await page.close(); }
  });

  test('End moves the caret to the end of the value in the spill editor', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 3);
      await cell.click({ position: { x: 30, y: 10 } });
      await page.keyboard.press('Home');
      assert.deepEqual((await readEditor(page)).caret, [0, 0], 'Home puts it at the start');
      await page.keyboard.press('End');
      const got = await readEditor(page);
      assert.deepEqual(got.caret, [got.value.length, got.value.length], 'End puts it at the end');
    } finally { await page.close(); }
  });

  test('Enter commits the spill editor and moves down', async () => {
    const page = await grid({ width: 760 });
    try {
      await page.evaluate((id) => {
        const td = document.querySelector(`tr[data-eid="${id}"] td.name-cell`);
        document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'));
        td.setAttribute('data-t', 'cell');
      }, squirrel.id);
      const cell = page.locator('[data-t="cell"]');
      await cell.click({ position: { x: 30, y: 10 } });
      assert.equal((await readEditor(page)).tag, 'TEXTAREA');
      await page.keyboard.press('End');
      await page.keyboard.type(' now');
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
      await page.keyboard.press('Enter');
      const res = await landed;
      assert.equal(res.request().postDataJSON().values?.Name, `${SQUIRREL} now`, 'the new value is saved');
      await page.waitForFunction((id) => document.querySelector(`tr[data-eid="${id}"] td.name-cell .text-dressed`)?.textContent?.endsWith(' now'), squirrel.id, { timeout: 5000 });
      const after = await page.evaluate((id) => ({
        editors: document.querySelectorAll('.wv-grid textarea').length,
        value: document.querySelector(`tr[data-eid="${id}"] td.name-cell .text-dressed`)?.textContent,
        down: document.activeElement?.closest?.('tr')?.dataset.eid !== id,
      }), squirrel.id);
      assert.equal(after.editors, 0, 'the textarea is gone');
      assert.equal(after.value, `${SQUIRREL} now`, 'the cell shows the saved value');
      assert.equal(after.down, true, 'and the cursor moved down the column');
    } finally { await page.close(); }
  });

  test('Esc cancels the spill editor and puts the value back', async () => {
    const page = await grid({ width: 760 });
    try {
      const cell = await tag(page, 4);
      await cell.click({ position: { x: 30, y: 10 } });
      const was = (await readEditor(page)).value;
      let patched = false;
      page.on('request', (r) => { if (r.method() === 'PATCH') patched = true; });
      await page.keyboard.press('End');
      await page.keyboard.type(' discarded');
      await page.keyboard.press('Escape');
      const after = await page.evaluate(() => {
        const td = document.querySelector('[data-t="cell"]');
        return { editors: document.querySelectorAll('.wv-grid textarea').length, value: td.querySelector('.text-dressed')?.textContent, rest: document.activeElement === td };
      });
      assert.equal(after.editors, 0, 'the textarea is gone');
      assert.equal(after.value, was, 'the value is the one before the edit');
      assert.equal(after.rest, true, 'and the cursor rests on the cell');
      await page.waitForTimeout(300);
      assert.equal(patched, false, 'nothing was saved');
    } finally { await page.close(); }
  });

  test('a touch screen gets no hover spill and taps straight into the cell', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, hasTouch: true, isMobile: true });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody td.name-cell.clipped');
      const hover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
      assert.equal(hover, false, 'the emulated screen reports no hover');
      const seen = await page.evaluate(async () => {
        const td = document.querySelector('.wv-grid tbody td.name-cell.clipped');
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 600));
        return !!document.querySelector('.cell-pop');
      });
      assert.equal(seen, false, 'no hover spill on touch');
      await page.locator('.wv-grid tbody td.name-cell.clipped').first().tap({ position: { x: 30, y: 10 } });
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      assert.notEqual(tag, 'TEXTAREA', 'a tap edits as before, with no spill editor');
    } finally { await page.close(); }
  });
}
