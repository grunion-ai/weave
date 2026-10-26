import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, probe } from './lib/cutoff.mjs';

const KEY = `sk-${'Antidisestablishmentarianism'.repeat(4)}`;

let table, row, board;
const s = await launch('key chip wrap', (weave) => {
  weave.createSpace({ name: 'Lab' });
  table = weave.createTable({ space: 'Lab', name: 'Sample' });
  weave.addField(table, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  weave.addField(table, { name: 'Secret', type: 'key' });
  row = weave.createEntity(table, { name: 'Long', values: { Status: 'Open', Secret: KEY } }).id;
  board = weave.tableView(`${table.id}/Board`, { layout: 'board', group: ['Status'] }).id;
});

if (s) {
  const { base, browser } = s;
  const handset = await engineOf(CELLS.phone.engine);
  const cells = {
    desktop: { browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };
  const surfaces = {
    board: { url: () => `${base}/#/table/${table.id}/view/${board}`, ready: () => '.wv-board .tile .tile-field[data-field="Secret"] .k-key > .k-label', root: '.wv-board' },
    record: {
      url: (cell) => (cell === 'phone' ? `${base}/#/table/${table.id}?e=${row}` : `${base}/#/entity/${row}`),
      ready: (cell) => (cell === 'phone' ? '#dock:not([hidden]) .fieldrow[data-field="Secret"] .k-key > .k-label' : '.entity-fields .fieldrow[data-field="Secret"] .k-key > .k-label'),
      root: (cell) => (cell === 'phone' ? '#dock' : '.entity-fields'),
    },
  };

  const measure = (page, selector, root) => page.evaluate(([sel, rootSel, probeSrc]) => {
    const label = document.querySelector(sel);
    const chip = label.parentElement;
    const host = chip.closest('dd, .fieldrow');
    const l = label.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const run = new Function(`return (${probeSrc})`)();
    return {
      text: label.textContent,
      hidden: label.scrollWidth - label.clientWidth,
      lines: Math.round(l.height / parseFloat(getComputedStyle(label).lineHeight)),
      insideHost: l.right <= h.right + 0.5 && l.left >= h.left - 0.5,
      findings: run(rootSel).filter((f) => String(f.selector).includes('k-key')).map((f) => `${f.kind} cut by ${f.px}px`),
    };
  }, [selector, root, probe.toString()]);

  for (const [cell, m] of Object.entries(cells)) {
    for (const [name, where] of Object.entries(surfaces)) {
      for (const colorScheme of ['light', 'dark']) {
        test(`${cell} ${name} ${colorScheme}: a long key breaks across lines and stays whole (Issue #1153)`, async (t) => {
          if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here`);
          const page = await m.browser.newPage({ ...m.page, colorScheme });
          try {
            await page.goto(where.url(cell), { waitUntil: 'networkidle' });
            const sel = where.ready(cell);
            await page.waitForSelector(sel);
            await page.evaluate(() => document.fonts?.ready);
            const root = typeof where.root === 'function' ? where.root(cell) : where.root;
            const got = await measure(page, sel, root);
            assert.ok(got.text.startsWith(KEY), `the chip carries the whole key (${got.text})`);
            assert.ok(got.hidden <= 1, `${got.hidden}px of the key is hidden past the label`);
            assert.ok(got.lines >= 2, `the key wraps onto more than one line (${got.lines})`);
            assert.ok(got.insideHost, 'the label stays inside its field');
            assert.deepEqual(got.findings, [], 'the cut-off probe finds nothing on the key chip');
          } finally { await page.close(); }
        });
      }
    }
  }
}
