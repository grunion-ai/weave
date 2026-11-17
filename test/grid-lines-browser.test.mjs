import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

const ROW = { compact: 32, comfortable: 44, spacious: 72 };
const LINES = { compact: 1, comfortable: 1, spacious: 3 };
const LONG = 'A plain value that runs on well past its column, so it wraps onto a second line, then a third line, and still has more words to show after that';
const DOC = Array.from({ length: 6 }, (_, k) => `Line ${k + 1} of the description runs on past the column edge with more words than fit`).join('\n\n');

let table, rows;
const s = await launch('grid line budget', (weave) => {
  weave.createSpace({ name: 'Desk' });
  const people = weave.createTable({ space: 'Desk', name: 'Person' });
  const folks = Array.from({ length: 12 }, (_, k) => weave.createEntity(people, { name: `Person ${k} with a long name` }));
  table = weave.createTable({ space: 'Desk', name: 'Note' });
  weave.addField(table, { name: 'Body', type: 'text' });
  const TAGS = Array.from({ length: 12 }, (_, k) => `tag-${k}`);
  weave.addField(table, { name: 'Tags', type: 'multiselect', config: { options: TAGS } });
  weave.addRelation(table, { name: 'Owners', targetDb: people, cardinality: 'many-to-many', inverseName: 'Notes' });
  rows = Array.from({ length: 6 }, (_, i) => {
    const e = weave.createEntity(table, { name: `Row ${i}: ${LONG}`, values: { Body: LONG, Tags: TAGS } });
    weave.link(e.id, 'Owners', folks.slice(0, i + 2).map((p) => p.id));
    weave.setDoc(e.id, DOC);
    return e;
  });
  const v = weave.tableView(table.id).views[0];
  weave.tableView(`${table.id}/${v.id}`, { widths: { Name: 240, Body: 240, Description: 240, Tags: 220, Owners: 170 } });
});

if (s) {
  const { base, browser } = s;
  const open = async (theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row td[data-field="Description"] .doc-preview');
    return page;
  };
  const density = async (page, mode) => {
    await page.evaluate((m) => document.querySelector('#main .table-wrap').wvSetDensity(m), mode);
    await page.waitForFunction((m) => document.querySelector('.wv-grid').dataset.density === m, mode);
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
  };
  const textLines = (page) => page.evaluate(() => {
    const inside = (r, c) => r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
    return [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].flatMap((tr) => ['Name', 'Body', 'Description'].map((field) => {
      const td = field === 'Name' ? tr.querySelector('td.name-cell') : tr.querySelector(`td[data-field="${field}"]`);
      const cb = td.querySelector(':scope > .wv-cb');
      const c = cb.getBoundingClientRect();
      const face = cb.firstElementChild;
      const shown = [...face.querySelectorAll('.doc-preview-line')].filter((n) => n.getClientRects().length);
      if (shown.length && getComputedStyle(shown[0]).display === 'block') {
        const last = shown.at(-1);
        return {
          field, tag: 'doc', lines: shown.length,
          lineH: [...new Set(shown.map((n) => Math.round(n.getBoundingClientRect().height)))],
          ellipsis: getComputedStyle(last).textOverflow === 'ellipsis' && last.scrollWidth > last.clientWidth + 1,
          inside: shown.every((n) => inside(n.getBoundingClientRect(), c)),
        };
      }
      const cs = getComputedStyle(face);
      const line = parseFloat(cs.lineHeight);
      const clamp = parseInt(cs.webkitLineClamp, 10) || 0;
      const lines = Math.round(face.clientHeight / line);
      return {
        field, tag: face.tagName.toLowerCase() + (face.classList.contains('text-dressed') ? '.text-dressed' : ''), lines, lineH: [line],
        ellipsis: lines > 1 ? clamp === lines && face.scrollHeight > face.clientHeight + 1 : cs.textOverflow === 'ellipsis' && face.scrollWidth > face.clientWidth + 1,
        inside: inside(face.getBoundingClientRect(), c),
      };
    }));
  });
  const chipRows = (page) => page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row td .ms-box')].map((box) => {
    const c = box.closest('.wv-cb').getBoundingClientRect();
    const chips = [...box.children].filter((n) => n.matches('.k:not(.k-more):not(.k-add), .mention-wrap'));
    const shown = chips.filter((n) => n.getClientRects().length);
    const more = box.querySelector(':scope > .k-more');
    const moreShown = more && more.getClientRects().length ? more : null;
    const faces = [...shown, ...(moreShown ? [moreShown] : [])];
    return {
      field: box.closest('td').dataset.field,
      rows: faces.map((n) => n.getBoundingClientRect().top).sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 4).length,
      total: chips.length, shown: shown.length,
      counted: moreShown ? Number(moreShown.textContent.replace(/\D/g, '')) : 0,
      out: faces.filter((n) => { const r = n.getBoundingClientRect(); return r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5; }).map((n) => n.textContent),
      sliced: shown.filter((n) => { const l = n.querySelector('.k-label') ?? n; return l.scrollWidth > l.clientWidth + 1 && getComputedStyle(l).textOverflow !== 'ellipsis'; }).map((n) => n.textContent),
    };
  }));
  const pitch = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((r) => Math.round(r.getBoundingClientRect().height * 100) / 100))]);

  for (const theme of ['light', 'dark']) {
    test(`Spacious shows three whole lines of a long Name, text and doc, each ending in an ellipsis, in a 72px row (Feature #354, ${theme})`, async () => {
      const page = await open(theme);
      try {
        await density(page, 'spacious');
        assert.deepEqual(await pitch(page), [ROW.spacious], 'every row paints at its 72px token');
        const cells = await textLines(page);
        assert.equal(cells.length, rows.length * 3);
        for (const c of cells) {
          assert.equal(c.lines, 3, `${c.field} shows three lines at Spacious: ${JSON.stringify(c)}`);
          assert.deepEqual(c.lineH, [18], `${c.field} sets its lines 18px apart: ${JSON.stringify(c)}`);
          assert.equal(c.ellipsis, true, `${c.field} ends its third line in an ellipsis: ${JSON.stringify(c)}`);
          assert.equal(c.inside, true, `${c.field} keeps every line inside its 56px cell box: ${JSON.stringify(c)}`);
        }
        assert.ok(cells.filter((c) => c.field !== 'Description').every((c) => c.tag === 'span.text-dressed'), `a plain text value rests as text that can wrap, not an input (Issue #447): ${JSON.stringify(cells.map((c) => c.tag))}`);
        assert.deepEqual(await page.evaluate(probe, '.wv-grid tbody'), [], 'no glyph in the grid is sliced by a box edge');
      } finally { await page.close(); }
    });
  }

  test('Comfortable and Compact keep one line ending in an ellipsis (Feature #354)', async () => {
    const page = await open();
    try {
      for (const d of ['comfortable', 'compact']) {
        await density(page, d);
        assert.deepEqual(await pitch(page), [ROW[d]], `${d}: every row paints at its token`);
        for (const c of await textLines(page)) {
          assert.equal(c.lines, LINES[d], `${d}: ${c.field} shows one line: ${JSON.stringify(c)}`);
          assert.equal(c.ellipsis, true, `${d}: ${c.field} ends in an ellipsis: ${JSON.stringify(c)}`);
          assert.equal(c.inside, true, `${d}: ${c.field} stays inside its cell box: ${JSON.stringify(c)}`);
        }
        assert.deepEqual(await page.evaluate(probe, '.wv-grid tbody'), [], `${d}: no glyph in the grid is sliced by a box edge`);
      }
    } finally { await page.close(); }
  });

  test('chips wrap to two rows of whole chips at Spacious and one row elsewhere, then count the rest (Feature #354)', async () => {
    const page = await open();
    try {
      for (const d of ['compact', 'comfortable', 'spacious']) {
        await density(page, d);
        const cells = await chipRows(page);
        assert.equal(cells.length, rows.length * 2, `${d}: the Tags and Owners cells painted`);
        for (const c of cells) {
          const most = d === 'spacious' ? 2 : 1;
          assert.ok(c.rows <= most, `${d}: ${c.field} chips sit on at most ${most} row(s): ${JSON.stringify(c)}`);
          if (c.counted) assert.equal(c.rows, most, `${d}: ${c.field} fills every row it has before it counts the rest: ${JSON.stringify(c)}`);
          assert.deepEqual(c.out, [], `${d}: no ${c.field} chip crosses its cell box`);
          assert.deepEqual(c.sliced, [], `${d}: no ${c.field} chip label is cut without an ellipsis`);
          assert.equal(c.total - c.shown, c.counted, `${d}: +N counts exactly the ${c.field} chips not shown: ${JSON.stringify(c)}`);
          if (c.field === 'Tags') assert.ok(c.counted > 0, `${d}: twelve tags never fit, so a +N shows: ${JSON.stringify(c)}`);
        }
      }
    } finally { await page.close(); }
  });

  test('a plain text Name rests as text and a click opens its editor with the whole value (Issue #447)', async () => {
    const page = await open();
    try {
      await density(page, 'spacious');
      const td = page.locator(`tr[data-eid="${rows[0].id}"] td.name-cell`);
      const rest = td.locator('.wv-cb > .text-dressed');
      assert.equal(await rest.textContent(), `Row 0: ${LONG}`);
      await rest.click();
      const editor = await page.evaluate(() => ({ tag: document.activeElement.tagName, value: document.activeElement.value, inCell: !!document.activeElement.closest('td.name-cell') }));
      assert.ok(['INPUT', 'TEXTAREA'].includes(editor.tag), `the click opens an editor: ${editor.tag}`);
      assert.deepEqual({ value: editor.value, inCell: editor.inCell }, { value: `Row 0: ${LONG}`, inCell: true }, 'with the whole value, in the Name cell');
      await page.keyboard.press('Escape');
      await rest.waitFor();
      assert.equal(await rest.textContent(), `Row 0: ${LONG}`, 'Escape puts the resting text back');
    } finally { await page.close(); }
  });
}
