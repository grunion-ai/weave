import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, projects, brief, launchRow;
const s = await launch('computed marks', (weave) => {
  weave.createSpace({ name: 'Product' });
  projects = weave.createTable({ space: 'Product', name: 'Project' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  weave.addField(tasks, { name: 'Project name', type: 'lookup', config: { relationField: 'Project', targetField: 'Name' } });
  weave.addField(tasks, { name: 'Double', type: 'formula', config: { expression: 'Estimate * 2' } });
  weave.addField(projects, { name: 'Total estimate', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  weave.updateField(projects, 'Chip', { config: { fields: ['Total estimate'] } });
  launchRow = weave.createEntity(projects, { name: 'Launch' });
  brief = weave.createEntity(tasks, { name: 'Brief', values: { Estimate: 3, Priority: 'Low', Project: launchRow.id } });
  weave.createEntity(tasks, { name: 'Spec', values: { Estimate: 5, Project: launchRow.id } });
});

const GLYPHS = { formula: 'ƒ', rollup: 'Σ', lookup: '↳' };
const LINK_ARROW = '↗';

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const token = (page) => page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.background = 'var(--wv-computed-bg)';
    const bg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return bg;
  });
  async function open(hash, colorScheme, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, colorScheme });
    await page.goto(`${base}/#${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await settle(page);
    return page;
  }

  test('computedMark draws formula, rollup and lookup as text glyphs, none the link chip arrow', async () => {
    const page = await open(`/table/${tasks.id}`, 'light', '.wv-grid tbody tr.entity-row');
    try {
      const got = await page.evaluate(() => ['formula', 'rollup', 'lookup'].map((t) => {
        const m = computedMark(t);
        return { type: t, mark: m, icon: typeof m === 'string' && m.startsWith('lucide:') };
      }));
      for (const g of got) {
        assert.equal(g.icon, false, `${g.type} is a text glyph`);
        assert.equal(g.mark, GLYPHS[g.type]);
        assert.notEqual(g.mark, LINK_ARROW, `${g.type} never wears the link chip's opens cue`);
      }
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`every header mark is a narrow text glyph that keeps clear of the next label (${colorScheme})`, async () => {
      for (const table of [tasks, projects]) {
        const page = await open(`/table/${table.id}`, colorScheme, '.wv-grid tbody tr.entity-row');
        try {
          const heads = await page.locator('.wv-grid thead th.col-head').evaluateAll((ths) => ths.map((th, i) => {
            const m = th.querySelector('.col-label .field-mark');
            const next = ths[i + 1]?.querySelector('.col-label');
            const mr = m?.getBoundingClientRect();
            return {
              col: th.dataset.col,
              mark: m && m.textContent,
              svg: !!m?.querySelector('svg, .ico'),
              width: mr?.width,
              right: mr?.right,
              thRight: th.getBoundingClientRect().right,
              nextLeft: next?.getBoundingClientRect().left ?? null,
            };
          }));
          const marked = heads.filter((h) => h.mark != null);
          assert.ok(marked.length >= 2, JSON.stringify(heads));
          for (const h of marked) {
            assert.equal(h.svg, false, `${h.col}: the mark draws no icon`);
            assert.match(h.mark, /^[ƒΣ↳→]$/, `${h.col}: one text glyph`);
            assert.ok(h.width < (h.mark === '→' ? 12 : 10), `${h.col}: ${h.width}px wide, a text glyph and not a 21px icon slot`);
            assert.ok(h.right <= h.thRight, `${h.col}: the mark stays inside its header`);
            if (h.nextLeft != null) assert.ok(h.nextLeft - h.right >= 20, `${h.col}: ${h.nextLeft - h.right}px to the next label`);
          }
          if (table === tasks) {
            const by = Object.fromEntries(heads.map((h) => [h.col, h.mark]));
            assert.equal(by.Double, 'ƒ');
            assert.equal(by['Project name'], '↳');
            assert.equal(by.Project, '→');
          } else {
            assert.equal(heads.find((h) => h.col === 'Total estimate').mark, 'Σ');
          }
        } finally { await page.close(); }
      }
    });

    test(`a computed table cell carries no glyph and no type word, and the whole cell takes the computed tint (${colorScheme})`, async () => {
      const page = await open(`/table/${tasks.id}`, colorScheme, '.wv-grid tbody tr.entity-row');
      try {
        const row = `tr[data-eid="${brief.id}"]`;
        const want = await token(page);
        assert.notEqual(want, 'rgba(0, 0, 0, 0)', 'the token is defined');
        for (const f of ['Double', 'Project name']) {
          const td = page.locator(`${row} td[data-field="${f}"]`);
          assert.equal(await td.locator('.computed-mark').count(), 0, `${f}: no value glyph`);
          assert.equal(await td.locator('.wv-tag').count(), 0, `${f}: no type word`);
          assert.equal(await td.evaluate((n) => getComputedStyle(n).backgroundColor), want, `${f}: the cell takes the tint`);
        }
        const plain = await page.locator(`${row} td[data-field="Estimate"]`).evaluate((n) => getComputedStyle(n).backgroundColor);
        assert.notEqual(plain, want, 'an editable cell stays untinted');
        await page.locator(`${row} td.sel-cell .sel-hit`).click();
        await page.waitForSelector(`${row}.row-selected`);
        const sel = (f) => page.locator(`${row} td[data-field="${f}"]`).evaluate((n) => getComputedStyle(n).backgroundColor);
        assert.equal(await sel('Double'), await sel('Estimate'), 'a selected row reads as selected across computed cells too');
      } finally { await page.close(); }
      const other = await open(`/table/${projects.id}`, colorScheme, '.wv-grid tbody tr.entity-row');
      try {
        const td = other.locator(`tr[data-eid="${launchRow.id}"] td[data-field="Total estimate"]`);
        assert.equal(await td.locator('.computed-mark').count(), 0);
        assert.equal(await td.evaluate((n) => getComputedStyle(n).backgroundColor), await token(other));
      } finally { await other.close(); }
    });

    test(`a record row boxes its computed value in the tint and lines its text up with editable values (${colorScheme})`, async () => {
      const page = await open(`/entity/${brief.id}`, colorScheme, '.entity-fields .fieldrow');
      try {
        const row = (name) => page.locator('.entity-fields .fieldrow', { has: page.locator('.fieldrow-label', { hasText: new RegExp(`^${name}`) }) });
        const textLeft = (loc) => loc.evaluate((n) => {
          const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim() ? 1 : 3) });
          const t = walk.nextNode();
          const r = document.createRange();
          r.selectNodeContents(t);
          return r.getBoundingClientRect().left - n.closest('.fieldrow').querySelector('.fieldrow-label').getBoundingClientRect().left;
        });
        const want = await token(page);
        const editable = await textLeft(row('Priority').locator('.k-select'));
        for (const [f, mark] of [['Double', 'ƒ'], ['Project name', '↳']]) {
          const r = row(f);
          assert.equal(await r.locator('.fieldrow-label .field-mark').textContent(), mark, `${f}: the label carries the glyph`);
          const box = r.locator('.k-computed');
          assert.equal(await box.locator('.computed-mark').count(), 0, `${f}: no value glyph`);
          assert.equal(await box.locator('.wv-tag').count(), 0, `${f}: no type word`);
          const face = await box.evaluate((n) => {
            const cs = getComputedStyle(n);
            return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, pad: `${cs.paddingTop} ${cs.paddingLeft}`, border: cs.borderTopWidth, cursor: cs.cursor, color: cs.color, body: getComputedStyle(document.body).color };
          });
          assert.equal(face.bg, want, `${f}: the box takes the tint`);
          assert.deepEqual([face.radius, face.pad, face.border, face.cursor], ['4px', '1px 8px', '0px', 'default']);
          assert.equal(face.color, face.body, `${f}: body-colour text`);
          const left = await textLeft(box);
          assert.ok(Math.abs(left - editable) <= 1, `${f}: text ${left}px past its label, editable text ${editable}px past its label`);
          await box.hover();
          assert.equal(await box.evaluate((n) => getComputedStyle(n).backgroundColor), want, `${f}: no hover change`);
        }
        const chip = await page.evaluate(() => {
          const probe = document.body.appendChild(document.createElement('span'));
          probe.className = 'k k-select hue-slate';
          const bg = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return bg;
        });
        const alpha = (c) => Number((c.match(/rgba?\(([^)]+)\)/)?.[1].split(',')[3]) ?? 1);
        assert.ok(alpha(want) < alpha(chip), `the tint (${want}) stays lighter than the slate chip (${chip})`);
      } finally { await page.close(); }
    });

    test(`an opened relation chip marks its computed field's label, not its value (${colorScheme})`, async () => {
      const page = await open(`/table/${tasks.id}`, colorScheme, '.wv-grid tbody tr.entity-row');
      try {
        const chip = page.locator(`tr[data-eid="${brief.id}"] td[data-field="Project"] .k-rel`).first();
        await chip.locator('.mention-caret').click();
        const seg = chip.locator('.mention-f[data-field="Total estimate"]');
        await seg.waitFor();
        assert.equal(await seg.locator('.mention-f-label .field-mark').textContent(), 'Σ');
        assert.equal(await seg.locator('.k-computed, .computed-mark').count(), 0, 'the value inside the chip wears no box');
        assert.match(await seg.textContent(), /8/, 'the rollup value is there');
      } finally { await page.close(); }
    });
  }
}
