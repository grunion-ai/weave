import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone } from './lib/browser.mjs';
import { seedDemo, openTable } from './lib/phone-matrix.mjs';

const s = await launch('phone matrix card list', (weave) => seedDemo(weave));

const CARDS = 'the table draws a grid, not phone cards, at this width';

if (s) {
  const { base, browser, tasks } = s;
  const matrix = await phoneMatrix(browser);
  const card = (page, name) => page.evaluate((name) => {
    const tr = [...document.querySelectorAll('#main .wv-grid tbody tr.entity-row')].find((n) => n.querySelector('.list-name')?.textContent.trim() === name);
    if (!(tr?.querySelector('.phone-lead')?.getBoundingClientRect().width > 0)) return null;
    const box = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, width: r.width }; };
    const lead = tr.querySelector('.pid-cell');
    const line = [...tr.children].filter((c) => c !== lead && c.getBoundingClientRect().width > 0);
    const select = document.querySelector('#main .wv-grid tbody tr.entity-row .k.k-select');
    return {
      state: box(tr.querySelector('.phone-lead')),
      name: box(tr.querySelector('.list-name')),
      line: line.map((c) => ({ ...box(c), text: c.textContent.trim() })),
      computed: [...tr.querySelectorAll('.computed')].map((n) => ({ text: n.textContent.trim(), bg: getComputedStyle(n).backgroundColor })),
      chipBg: select && getComputedStyle(select).backgroundColor,
    };
  }, name);

  test('the phone card list starts its field chip line at the state chip or the name, not at an inset of its own (Issue #1387)', { todo: 'Issue #1387' }, async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openTable(page, base, tasks);
      const c = await card(page, 'Write API quickstart');
      if (!c) return CARDS;
      const start = Math.round(c.line[0].left);
      const lined = [c.state.left, c.name.left].some((x) => Math.abs(start - Math.round(x)) <= 2);
      assert.ok(lined, `the chip line starts at ${start} px; the state chip starts at ${Math.round(c.state.left)} px and the name at ${Math.round(c.name.left)} px`);
    });
  });

  test('a formula that returns text sits on the phone card chip line as a chip like every other value (Issue #1388)', async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openTable(page, base, tasks);
      const c = await card(page, 'Draft launch post');
      if (!c) return CARDS;
      const size = c.computed.find((v) => v.text === 'unsized');
      assert.ok(size, `the card for a row with only a name shows its Size formula (${JSON.stringify(c.computed)})`);
      assert.ok(c.chipBg && !/,\s*0\)$|transparent/.test(c.chipBg), `a select chip fills its background (${c.chipBg})`);
      assert.equal(size.bg, c.chipBg, `"unsized" is drawn on ${size.bg} while a select chip fills ${c.chipBg}`);
    });
  });
}
