import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

let deals, acme;
const s = await launch('icon centre', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const companies = weave.createTable({ space: 'Sales', name: 'Company' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Stage', type: 'select', config: { options: [{ name: 'Lead', hue: 'blue' }, { name: 'Won', hue: 'green' }] } });
  weave.addRelation(deals, { name: 'Company', targetDb: companies, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.createEntity(companies, { name: 'Initech' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', values: { Amount: 1200, Stage: 'Lead' } });
  weave.createEntity(deals, { name: 'Globex Renewal', values: { Amount: 800, Stage: 'Won' } });
  weave.setDoc(acme.id, '# Terms\n\nNet 30.\n');
});

const probe = () => {
  const shows = (r) => r.width > 0 && r.height > 0;
  const seen = (n) => {
    for (let a = n; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const inFlow = (n, stop) => {
    for (let a = n; a && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') return false;
    }
    return true;
  };
  const textRects = (b, skip) => {
    const rects = [];
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim() || skip.contains(t) || !inFlow(t.parentElement, b)) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      rects.push(...[...range.getClientRects()].filter(shows));
    }
    return rects;
  };
  const lone = [];
  const labelled = [];
  for (const b of document.querySelectorAll('button, a.btn, [role="button"]')) {
    const box = b.getBoundingClientRect();
    if (!shows(box) || !seen(b)) continue;
    const icons = [...b.querySelectorAll('.wv-icon')].filter((i) => shows(i.getBoundingClientRect()) && inFlow(i, b));
    if (icons.length !== 1) continue;
    const icon = icons[0];
    const g = (icon.querySelector('svg') ?? icon).getBoundingClientRect();
    const what = b.getAttribute('aria-label') || b.title || b.className;
    const text = textRects(b, icon);
    if (text.length) {
      const after = text.filter((r) => r.left >= g.right - 1);
      if (after.length) labelled.push({ what, gap: Math.round((Math.min(...after.map((r) => r.left)) - g.right) * 100) / 100 });
      continue;
    }
    const extra = [...b.querySelectorAll('*')].some((n) => !icon.contains(n) && !n.contains(icon)
      && n.children.length === 0 && shows(n.getBoundingClientRect()) && inFlow(n, b));
    if (extra) continue;
    lone.push({
      what,
      dx: Math.round(((g.left + g.width / 2) - (box.left + box.width / 2)) * 100) / 100,
      dy: Math.round(((g.top + g.height / 2) - (box.top + box.height / 2)) * 100) / 100,
    });
  }
  return { lone, labelled };
};

test('icons carry no margin: spacing between an icon and its label is the host gap', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const rules = css.match(/[^{}]*\.wv-icon[^{}]*\{[^}]*\}/g) ?? [];
  const margined = rules.filter((r) => /margin(-right|-inline-end)?\s*:/.test(r)).map((r) => r.trim().slice(0, 90));
  assert.deepEqual(margined, [], 'no rule sets a margin on .wv-icon');
  assert.match(css, /:where\(button, \.btn, \.chip-trigger, \.k, \.filter-chip\):where\(:has\(> \.wv-icon\)\) \{ display: inline-flex; align-items: center; gap: 5px; \}/);
});

if (s) {
  const { base, browser } = s;
  const widths = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]];
  const check = ({ lone, labelled }, where) => {
    assert.ok(lone.length, `${where}: icon-only buttons were found`);
    const off = lone.filter((b) => Math.abs(b.dx) > 0.5 || Math.abs(b.dy) > 0.5);
    assert.deepEqual(off, [], `${where}: every icon-only button centres its glyph within 0.5px of its hit area`);
    const tight = labelled.filter((b) => b.gap < 4);
    assert.deepEqual(tight, [], `${where}: an icon beside a label keeps at least 4px before the text`);
  };

  for (const theme of ['light', 'dark']) {
    test(`the workspace home centres every icon-only button (${theme})`, async () => {
      const page = await browser.newPage({ viewport: widths[0][1] });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#ws-new svg');
        await page.waitForSelector('.nav-caret svg');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        check(await page.evaluate(probe), `home ${theme}`);
      } finally { await page.close(); }
    });
  }

  for (const [size, viewport] of widths) {
    test(`${size}: the table page and its selection bar centre every icon-only button`, async () => {
      const page = await browser.newPage({ viewport: widths[0][1] });
      try {
        await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.locator('.wv-grid tbody .sel-box').first().check();
        await page.waitForSelector('.sel-puck .sel-act.danger');
        await page.setViewportSize(viewport);
        await page.locator('.sel-puck').evaluate((n) => Promise.all(n.getAnimations({ subtree: true }).map((a) => a.finished)));
        const found = await page.evaluate(probe);
        assert.ok(found.lone.some((b) => b.what === 'Move to trash'), 'the selection bar trash is measured');
        check(found, `${size} table`);
      } finally { await page.close(); }
    });

    test(`${size}: the entity page centres every icon-only button`, async () => {
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main .name-edit');
        check(await page.evaluate(probe), `${size} entity`);
      } finally { await page.close(); }
    });
  }

  test('the views popover centres its grip and hold-to-delete buttons', async () => {
    const page = await browser.newPage({ viewport: widths[0][1] });
    try {
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.locator('.table-view-btn').click();
      await page.waitForSelector('.table-view-popover .view-del');
      const found = await page.evaluate(probe);
      assert.ok(found.lone.some((b) => /^Hold to delete/.test(b.what)), 'the view delete button is measured');
      assert.ok(found.lone.some((b) => /^Reorder/.test(b.what)), 'the view grip is measured');
      check(found, 'views popover');
    } finally { await page.close(); }
  });

  test('a filter chip label is trimmed to cap height, so its letters centre on the dot', async () => {
    const page = await browser.newPage({ viewport: widths[0][1] });
    try {
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.locator('.table-filter-btn').click();
      await page.waitForSelector('.table-filter-popover .filter-chip .opt-dot');
      const m = await page.locator('.table-filter-popover .filter-chip:has(.opt-dot)').first().evaluate((chip) => {
        const mid = (r) => r.top + r.height / 2;
        const label = chip.querySelector('.filter-chip-label');
        const dot = chip.querySelector('.opt-dot').getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return { label: label.textContent, trim: getComputedStyle(label).textBoxTrim, dot: mid(dot), text: mid(text) };
      });
      assert.equal(m.label, 'Lead');
      assert.equal(m.trim, 'trim-both');
      assert.ok(Math.abs(m.dot - m.text) <= 0.5, `dot centre ${m.dot} vs cap-height label centre ${m.text}`);
    } finally { await page.close(); }
  });
}
