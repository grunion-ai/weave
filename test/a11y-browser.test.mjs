import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch } from './lib/browser.mjs';

const AXE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vendor/axe-4.10.2.min.js'), 'utf8');
const RULES = ['label', 'region', 'color-contrast', 'aria-prohibited-attr', 'label-title-only'];

let task, issue, entityId;
const s = await launch('a11y baseline', (weave) => {
  weave.createSpace({ name: 'Work' });
  task = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(task, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In progress', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(task, { name: 'Notes', type: 'text' });
  issue = weave.createTable({ space: 'Work', name: 'Issue' });
  weave.addField(issue, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issue, { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Looks broken'] } });
  weave.addField(issue, { name: 'Points', type: 'number' });
  weave.addField(issue, { name: 'Double', type: 'formula', config: { expression: 'Points * 2' } });
  weave.addField(issue, { name: 'Due', type: 'date' });
  weave.addField(issue, { name: 'Done', type: 'checkbox' });
  weave.addField(issue, { name: 'Link', type: 'url' });
  weave.addField(issue, { name: 'Brief', type: 'document' });
  weave.addRelation(issue, { name: 'Task', targetDb: task, cardinality: 'many-to-one', inverseName: 'Issues' });
  const t1 = weave.createEntity(task, { name: 'Write the plan', values: { Status: 'In progress', Notes: 'first pass' } });
  weave.createEntity(task, { name: 'Ship it', values: { Status: 'Open' } });
  const i1 = weave.createEntity(issue, { name: 'Grid is slow', values: {
    Severity: 'High', Symptom: ['Slow'], Points: 3, Due: '2026-10-01', Done: false, Link: 'https://example.com', Task: t1.id } });
  weave.createEntity(issue, { name: 'Chip wraps', values: { Severity: 'Low', Points: 1 } });
  weave.setDoc(i1.id, `Measured on [[Task#${t1.publicId}]].\n\n## Steps\n\nOpen the grid and scroll.\n`, 'Brief');
  entityId = i1.id;
});

if (s) {
  const { base, browser } = s;

  const VIEWS = [
    ['Task table', () => `#/table/${task.id}`, '.wv-grid tbody tr.entity-row'],
    ['Issue table', () => `#/table/${issue.id}`, '.wv-grid tbody tr.entity-row'],
    ['entity page', () => `#/entity/${entityId}`, '.vditor-ir [contenteditable="true"]'],
    ['map', () => '#/map', '#main .view-title'],
  ];

  const open = async (hash, ready, theme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    return page;
  };

  const axe = async (page) => {
    await page.addScriptTag({ content: AXE });
    return page.evaluate((rules) => window.axe.run(
      { include: [document], exclude: [['.vditor']] },
      { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] },
    ).then((r) => r.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => `${n.target.join(' ')}${n.any[0]?.data?.contrastRatio ? ` ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}:1` : ''}`),
    }))), RULES);
  };

  for (const theme of ['light', 'dark']) {
    for (const [name, hash, ready] of VIEWS) {
      test(`${name}, ${theme}: no label, region or contrast violations outside Vditor`, async () => {
        const page = await open(hash(), ready, theme);
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          const v = await axe(page);
          assert.deepEqual(v, [], `axe violations:\n${v.map((x) => `${x.id}\n  ${x.nodes.join('\n  ')}`).join('\n')}`);
        } finally { await page.close(); }
      });
    }
  }

  const ringContrast = (page, sel) => page.evaluate((selector) => {
    const target = document.querySelector(selector);
    if (!target) return { missing: selector };
    target.focus();
    const rgb = (c) => {
      const cv = document.createElement('canvas').getContext('2d');
      cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const lum = ({ r, g, b }) => {
      const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bg = null;
    for (let n = target.parentElement; n && !bg; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.a > 0.9) bg = c;
    }
    bg ??= rgb(getComputedStyle(document.body).backgroundColor);
    const cs = getComputedStyle(target);
    const ring = rgb(cs.outlineColor);
    const [a, b] = [lum(ring), lum(bg)].sort((x, y) => y - x);
    return {
      focused: document.activeElement === target,
      visible: target.matches(':focus-visible'),
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      alpha: ring.a,
      ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
    };
  }, sel);

  for (const theme of ['light', 'dark']) {
    test(`${theme}: toolbar, dock, sidebar and name field carry one ring at 3:1 or better`, async () => {
      const page = await open(`#/table/${issue.id}`, '.wv-grid tbody tr.entity-row', theme);
      try {
        await page.keyboard.press('Tab');
        for (const sel of ['.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn']) {
          const r = await ringContrast(page, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.equal(r.style, 'solid', `${sel} draws the outline ring`);
          assert.ok(r.width >= 2, `${sel} ring is ${r.width}px`);
          assert.equal(r.alpha, 1, `${sel} ring is opaque`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
        await page.click('td.pid-cell a.open-link');
        await page.waitForSelector('#dock .pose-btn');
        await page.keyboard.press('Shift+Tab');
        for (const sel of ['#dock .pose-btn', '#dock button[aria-label^="Close"]']) {
          const r = await ringContrast(page, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.ok(r.style === 'solid' && r.width >= 2 && r.alpha === 1, `${sel} draws the branded ring (${JSON.stringify(r)})`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
      } finally { await page.close(); }
      const ent = await open(`#/entity/${entityId}`, '.entity-head', theme);
      try {
        await ent.keyboard.press('Tab');
        for (const sel of ['.entity-head textarea.name-edit', '#nav .nav-db', '#search-btn']) {
          const r = await ringContrast(ent, sel);
          assert.ok(r.focused && r.visible, `${sel} takes keyboard focus (${JSON.stringify(r)})`);
          assert.ok(r.style === 'solid' && r.width >= 2 && r.alpha === 1, `${sel} draws the branded ring (${JSON.stringify(r)})`);
          assert.ok(r.ratio >= 3, `${sel} ring contrast ${r.ratio}:1 in ${theme}`);
        }
      } finally { await ent.close(); }
    });
  }

  test('the first Tab stop is a skip link that lands on #main', async () => {
    const page = await open(`#/table/${task.id}`, '.wv-grid tbody tr.entity-row', 'light');
    try {
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => {
        const a = document.activeElement;
        const r = a.getBoundingClientRect();
        return { cls: a.className, href: a.getAttribute('href'), text: a.textContent.trim(), onScreen: r.width > 0 && r.top >= 0 };
      });
      assert.equal(first.cls, 'skip-link');
      assert.equal(first.text, 'Skip to content');
      assert.ok(first.onScreen, 'it shows itself once focused');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'Enter moves focus into the content');
      assert.match(await page.evaluate(() => location.hash), /^#\/table\//, 'and leaves the route alone');
    } finally { await page.close(); }
  });

  test('grid inputs are named by column and row', async () => {
    const page = await open(`#/table/${issue.id}`, '.wv-grid tbody tr.entity-row', 'light');
    try {
      const names = await page.$$eval('.wv-grid tbody tr.entity-row td .inline-edit', (xs) => xs.map((x) => x.getAttribute('aria-label')));
      assert.ok(names.length > 0, 'the grid has inline editors');
      assert.ok(names.includes('Points, Grid is slow'), `a number cell reads "Points, Grid is slow" (got ${JSON.stringify(names)})`);
      assert.ok(names.every(Boolean), 'every inline editor has a name');
    } finally { await page.close(); }
  });

  const hitArea = (page, sels, square = true) => page.evaluate(([list, sq]) => list.map((sel) => {
    const n = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length);
    if (!n) return { sel, missing: true };
    n.scrollIntoView({ block: 'center', inline: 'center' });
    const r = n.getBoundingClientRect();
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
    const misses = (sq ? [[-11.5, -11.5], [11.5, -11.5], [-11.5, 11.5], [11.5, 11.5]] : [[0, -11.5], [0, 11.5]])
      .filter(([dx, dy]) => !n.contains(document.elementFromPoint(cx + dx, cy + dy)));
    return { sel, box: `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`, misses: misses.length };
  }), [sels, square]);

  test('small controls offer a 24px hit area', async () => {
    const page = await open(`#/table/${issue.id}`, '.wv-grid tbody tr.entity-row', 'light');
    try {
      await page.hover('#nav .nav-db');
      for (const h of await hitArea(page, ['#nav-collapse', 'button.add-field-btn', '.nav-db-menu .dots-btn', 'td.pid-cell a.open-link', 'button.mention-caret'])) {
        assert.ok(!h.missing, `${h.sel} is on the page`);
        assert.equal(h.misses, 0, `${h.sel} (${h.box}) takes a click across 24px`);
      }
      assert.equal(await page.$eval('button.mention-caret', (c) => c.closest('a') ? 'inside the link' : 'beside the link'), 'beside the link',
        'the caret is its own target, so the 24px box can claim the pixels around it');
    } finally { await page.close(); }
    const ent = await open(`#/entity/${entityId}`, '.entity-head', 'light');
    try {
      for (const h of await hitArea(ent, ['button.doc-caret'])) {
        assert.ok(!h.missing, `${h.sel} is on the page`);
        assert.equal(h.misses, 0, `${h.sel} (${h.box}) takes a click across 24px`);
      }
    } finally { await ent.close(); }
  });
}
