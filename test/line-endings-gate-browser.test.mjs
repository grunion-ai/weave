import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, ENDING_KINDS, endingPrint, probe, proseSeed, setDensity, sweepEndings } from './lib/cutoff.mjs';
import { DENSITIES } from './lib/states.mjs';

const s = await launch('line endings', proseSeed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };

  const LINE = 'font: 14px/20px sans-serif; width: 300px; margin: 0;';
  const fixture = (html) => async (page) => {
    await page.setContent(`<!doctype html><body style="margin: 20px">${html}</body>`);
    return page.evaluate(probe, { root: null, endings: true });
  };
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const cases = [
    ['a max-height that stops inside a line is a sliced line', `<div style="${LINE} max-height: 50px; overflow: hidden"><p style="margin: 0">${words(40)}</p></div>`, ['sliced-line', 'unreadable']],
    ['a line clamp ends on a whole line', `<p style="${LINE} display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden" title="${words(40)}">${words(40)}</p>`, []],
    ['a line clamp over paragraphs ends on a whole line', `<div style="${LINE} display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden" title="${words(10)} ${words(40)}"><p style="margin: 6px 0">${words(10)}</p><p style="margin: 6px 0">${words(40)}</p></div>`, []],
    ['an ellipsis with no title has no way to read the value', `<div style="${LINE} white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${words(40)}</div>`, ['unreadable']],
    ['an ellipsis with the full value on hover is readable', `<div style="${LINE} white-space: nowrap; overflow: hidden; text-overflow: ellipsis" title="${words(40)}">${words(40)}</div>`, []],
    ['a title holding less than the value does not count', `<div style="${LINE} white-space: nowrap; overflow: hidden; text-overflow: ellipsis" title="Open this">${words(40)}</div>`, ['unreadable']],
    ['a field whose value runs past its box and has no title is unreadable', `<input style="font: 14px sans-serif; width: 80px" value="${words(40)}">`, ['unreadable']],
    ['a single word on the last line of prose is a lone word', `<p style="${LINE} text-wrap: wrap">Every line of this paragraph runs on until it reaches a width where one word lands alone<br>on a line of its own and a short tail word</p><p style="font: 14px/20px monospace; width: 192px; margin: 0">aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq</p>`, ['lone-word']],
    ['a last word too long to share a line is not rag', `<p style="font: 14px/20px monospace; width: 192px; margin: 0">aaaa bbbb cccc dddd eeee ${'z'.repeat(22)}</p>`, []],
    ['a lone word inside a button is not prose', `<button style="font: 14px/20px monospace; width: 96px">aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll</button>`, []],
  ];
  for (const [name, html, want] of cases) {
    test(`the probe: ${name}`, async () => {
      const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport });
      try {
        const got = (await fixture(html)(page)).map((f) => f.kind);
        assert.deepEqual([...new Set(got)].sort(), [...want].sort());
      } finally { await page.close(); }
    });
  }

  test('every kind the probe reports is a kind the gate names', () => {
    assert.deepEqual(ENDING_KINDS, ['sliced-line', 'lone-word', 'unreadable']);
  });

  const longName = () => s.weave.query(s.prose.table, { limit: 1 }).items[0];
  const open = async (cell, url) => {
    const m = matrix[cell];
    const page = await m.browser.newPage(m.page);
    await page.goto(`${s.base}/${url}`, { waitUntil: 'networkidle' });
    return page;
  };
  for (const cell of Object.keys(CELLS)) {
    test(`${cell}: a plain text value shows the lines its density sets, with the full value on hover (Issue #447)`, async (t) => {
      if (!matrix[cell]) return t.skip(`${CELLS[cell].engine} cannot launch here`);
      const row = longName();
      const field = 'Summary';
      for (const [density, lines] of [['compact', 1], ['comfortable', 1], ['spacious', 2]]) {
        setDensity(s.weave, density);
        const page = await open(cell, `#/table/${s.prose.table}`);
        try {
          const shape = await page.locator(`tr[data-eid="${row.id}"] td[data-field="${field}"] .wv-cb > *`).first().evaluate((e) => {
            const cs = getComputedStyle(e);
            const value = e.value ?? e.textContent;
            let shown = 1;
            if (e.tagName !== 'INPUT') {
              const range = document.createRange();
              range.selectNodeContents(e);
              const box = e.getBoundingClientRect();
              shown = new Set([...range.getClientRects()].filter((r) => r.width && r.top < box.bottom - 1).map((r) => Math.round(r.top))).size;
            }
            return { tag: e.tagName, title: e.title, value, shown, cut: cs.textOverflow };
          });
          assert.equal(shape.tag, density === 'spacious' ? 'SPAN' : 'INPUT', `${density} rests as ${shape.tag}`);
          assert.equal(shape.title, shape.value, `${density}: hover reads the whole value`);
          if (cell === 'desktop') assert.equal(shape.shown, lines, `${density} shows ${shape.shown} lines`);
        } finally {
          await page.close();
          setDensity(s.weave, 'comfortable');
        }
      }
    });

    test(`${cell}: the related subtable fits its card and ends a long value in an ellipsis (Issue #1260)`, async (t) => {
      if (!matrix[cell]) return t.skip(`${CELLS[cell].engine} cannot launch here`);
      const page = await open(cell, cell === 'phone' ? `#/table/${s.sink.table}?e=${s.sink.row}` : `#/entity/${s.sink.row}`);
      try {
        const section = page.locator('.related-section[data-field] >> visible=true').first();
        await section.waitFor();
        const fit = await section.evaluate((n) => {
          const card = n.querySelector('.card');
          const value = [...n.querySelectorAll('.text-dressed')].find((e) => e.textContent.startsWith('Housing'));
          return { client: card.clientWidth, scroll: card.scrollWidth, title: value.title, over: value.scrollWidth - value.clientWidth, value: value.clientWidth, cut: getComputedStyle(value).textOverflow };
        });
        if (cell === 'desktop') assert.equal(fit.scroll, fit.client, `the card scrolls sideways: ${JSON.stringify(fit)}`);
        else assert.ok(fit.scroll < fit.client * 2, `the card stays near its width: ${JSON.stringify(fit)}`);
        assert.ok(fit.title.startsWith('Housing') && fit.title.length > 100, 'hover reads the whole value');
        assert.ok(fit.over > 0 && fit.cut === 'ellipsis', `a long value ends in an ellipsis: ${JSON.stringify(fit)}`);
      } finally { await page.close(); }
    });
  }

  test('phone: a long state stays on one line in the dense row and reads in full on the record page (Issue #1152)', async (t) => {
    if (!matrix.phone) return t.skip('webkit cannot launch here');
    const page = await open('phone', `#/table/${s.sink.table}?e=${s.sink.row}`);
    try {
      const name = 'Waiting on the vendor to countersign the renewal';
      const lead = page.locator('.phone-lead > .k-state').filter({ hasText: name }).first();
      const row = await lead.evaluate((e) => ({ title: e.title, height: e.getBoundingClientRect().height, wrap: getComputedStyle(e).whiteSpace }));
      assert.equal(row.wrap, 'nowrap');
      assert.ok(row.height <= 20, `one line in the dense row: ${row.height}px`);
      const label = page.locator('#dock .fieldrow[data-field="Status"] .k-state > .k-label').first();
      const whole = await label.evaluate((e) => ({ text: e.textContent, over: e.scrollWidth - e.clientWidth, wrap: getComputedStyle(e).whiteSpace }));
      assert.equal(whole.text.trim(), name);
      assert.ok(whole.over <= 1, `the record page hides ${whole.over}px of the name`);
      assert.equal(whole.wrap, 'normal');
    } finally { await page.close(); }
  });

  for (const cell of Object.keys(CELLS)) {
    for (const density of DENSITIES) {
      test(`${cell} at ${density}: no sliced line, no lone word in prose, no cut value without a way to read it (Issue #1306)`, async (t) => {
        const m = matrix[cell];
        if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here`);
        const { findings, failed } = await sweepEndings(m.browser, cell, s, { page: m.page, densities: [density] });
        assert.deepEqual(failed, [], 'a journey or overlay could not finish: its selectors rotted');
        for (const f of findings) t.diagnostic(`${endingPrint(f)} at ${f.where}: ${JSON.stringify(f.text)} ${f.px}px`);
        assert.deepEqual([...new Set(findings.map(endingPrint))], [], 'give the text its role from DESIGN.md: a whole-line clamp, a wrap, or the full value on hover');
      });
    }
  }
}
