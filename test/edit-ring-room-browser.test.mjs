import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let table, row;
const s = await launch('edit ring room', (weave) => {
  weave.createSpace({ name: 'Squirrel' });
  table = weave.createTable({ space: 'Squirrel', name: 'Digest' });
  weave.addField(table, { name: 'Prompt', type: 'text' });
  weave.addField(table, { name: 'Runs', type: 'number' });
  row = weave.createEntity(table, { name: 'Weekly squirrel digest', values: { Prompt: 'Run it from net.weave workflows', Runs: 4 } });
});

if (s) {
  const { base, browser } = s;
  const box = (page, sel) => page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const textLeft = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const textTop = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    const rowEl = el.closest('tr, .fieldrow');
    const inset = cs.boxShadow.match(/^(rgba?\([^)]*\)) 0px 0px 0px ([\d.]+)px inset$/);
    return {
      left: r.left, top: r.top, width: r.width, height: r.height, textLeft, textTop,
      rowHeight: rowEl.getBoundingClientRect().height,
      ring: inset ? parseFloat(inset[2]) : 0,
      radius: cs.borderTopLeftRadius,
      unclipped: (() => {
        for (let n = el.parentElement; n && n !== rowEl; n = n.parentElement) {
          const o = getComputedStyle(n).overflowX;
          if (o === 'visible') continue;
          const p = n.getBoundingClientRect();
          const ps = getComputedStyle(n);
          const inner = { left: p.left + parseFloat(ps.borderLeftWidth), right: p.right - parseFloat(ps.borderRightWidth), top: p.top + parseFloat(ps.borderTopWidth), bottom: p.bottom - parseFloat(ps.borderBottomWidth) };
          if (r.left < inner.left - 0.5 || r.right > inner.right + 0.5 || r.top < inner.top - 0.5 || r.bottom > inner.bottom + 0.5) return `${n.className} clips it`;
        }
        return true;
      })(),
      focused: document.activeElement === el,
    };
  });
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.5, `${what}: ${a} vs ${b}`);
  const roomy = (rest, edit, label) => {
    assert.equal(edit.focused, true, `${label} takes focus`);
    near(edit.textLeft, rest.textLeft, `${label} text stays put horizontally`);
    near(edit.textTop, rest.textTop, `${label} text stays put vertically`);
    near(edit.rowHeight, rest.rowHeight, `${label} row keeps its height`);
    near(edit.left, rest.left - 4, `${label} box grows 4px to the left`);
    near(edit.top, rest.top - 4, `${label} box grows 4px upward`);
    near(edit.height, rest.height + 8, `${label} box gains 8px of height`);
    assert.equal(edit.ring, 2, `${label} draws a 2px ring`);
    assert.equal(edit.radius, '8px', `${label} is rounded 8px`);
    assert.equal(edit.unclipped, true, `${label} shows its whole ring`);
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`a focused grid cell gains room around its text without moving it (Issue #1366, ${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
        for (const sel of [`tr[data-eid="${row.id}"] td.name-cell input.inline-edit`, `tr[data-eid="${row.id}"] td[data-field="Prompt"] input.inline-edit`]) {
          await page.waitForSelector(sel);
          const rest = await box(page, sel);
          await page.click(sel);
          await page.waitForFunction((q) => document.activeElement === document.querySelector(q), sel);
          await settled(page.locator(sel));
          roomy(rest, await box(page, sel), sel);
          await page.keyboard.press('Escape');
          await page.$eval(sel, (el) => el.blur());
        }
      } finally { await page.close(); }
    });

    test(`a focused entity field gains room around its text without moving it (Issue #1366, ${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        const sel = '.entity-fields .fieldrow > input.inline-edit';
        await page.waitForSelector(sel);
        const rest = await box(page, sel);
        await page.click(sel);
        await page.waitForFunction((q) => document.activeElement === document.querySelector(q), sel);
        await settled(page.locator(sel));
        roomy(rest, await box(page, sel), 'field row');
        await page.keyboard.press('Escape');
        await page.$eval(sel, (el) => el.blur());
        const dressed = '.entity-fields .fieldrow > .text-dressed';
        await page.waitForSelector(dressed);
        const quiet = await box(page, dressed);
        await page.click(dressed);
        const open = '.entity-fields .fieldrow > input.inline-edit:focus';
        await page.waitForSelector(open);
        await settled(page.locator(open));
        roomy(quiet, await box(page, open), 'text field row');
      } finally { await page.close(); }
    });
  }
}
