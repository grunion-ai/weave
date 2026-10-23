import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table, row, cited;
const s = await launch('activity in two places', (weave) => {
  weave.revisionWindowMs = 0;
  weave.createSpace({ name: 'Dev' });
  table = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.addField(table, { name: 'Spec', type: 'document' });
  weave.addField(table, { name: 'Priority', type: 'select', config: { options: ['P1', 'P2'] } });
  weave.updateTable(table, { systemFields: ['Created At'] });
  cited = weave.createEntity(table, { name: 'Cited', doc: 'nothing yet' });
  row = weave.createEntity(table, { name: 'Two places', doc: 'first draft', values: { Priority: 'P2' } });
  weave.setDoc(row.id, 'second draft, after [[Issue#1]]', 'Description');
  weave.setDoc(row.id, 'spec one', 'Spec');
  weave.setDoc(row.id, 'spec two', 'Spec');
  weave.updateEntity(row.id, { Priority: 'P1' });
});

const ACTIVITY = /\b(activity|history)\b/i;

if (s) {
  const { browser, base } = s;
  const page = async (hash) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return p;
  };
  const popoverText = (p) => p.locator('.chip-pop').innerText();
  const closePop = async (p) => { await p.keyboard.press('Escape'); await p.waitForSelector('.chip-pop', { state: 'detached' }); };
  const entryPoints = (p, mountSel) => p.evaluate((sel) => {
    const mount = document.querySelector(sel);
    const named = [...mount.querySelectorAll('button, a, [role="button"], .card-title')].filter((n) => {
      if (n.closest('aside.wv-activity')) return false;
      const words = [n.getAttribute('aria-label'), n.getAttribute('title'), n.textContent].join(' ');
      return /\b(activity|history)\b/i.test(words) || (n.getAttribute('href') ?? '').startsWith('#/activity');
    });
    return {
      named: named.map((n) => n.className || n.tagName),
      toolbar: mount.querySelectorAll('.crumb-actions .activity-btn').length,
      docHistory: mount.querySelectorAll('.doc-history-btn').length,
      sideTitles: [...mount.querySelectorAll('.entity-side .card-title')].map((n) => n.textContent),
    };
  }, mountSel);

  test('the table field menu and the show/hide popover offer no Activity entry (Feature #315)', async () => {
    const p = await page(`#/table/${table.id}`);
    try {
      await p.waitForSelector('.wv-grid tbody tr.entity-row');
      const heads = await p.locator('.wv-grid thead th').allInnerTexts();
      assert.equal(heads.some((h) => ACTIVITY.test(h)), false, `no Activity column (${heads.join(' | ')})`);
      const th = p.locator('.wv-grid thead th.col-head', { hasText: 'Priority' }).first();
      await th.hover();
      await th.locator('.field-menu').click();
      await p.waitForSelector('.chip-pop .wv-menu-row');
      assert.doesNotMatch(await popoverText(p), ACTIVITY, 'the field menu has no Activity or History item');
      await closePop(p);
      await p.click('#main .eye-btn');
      await p.waitForSelector('.chip-pop .eye-row');
      const rows = await p.locator('.chip-pop .eye-label').allInnerTexts();
      assert.ok(rows.includes('Created At'), `the system section still lists the stamps (${rows.join(', ')})`);
      assert.equal(rows.some((r) => ACTIVITY.test(r)), false, `the show/hide popover has no Activity row (${rows.join(', ')})`);
    } finally { await p.close(); }
  });

  test('the record page has one activity entry point, the toolbar button, and keeps its reference cards (Feature #315)', async () => {
    const p = await page(`#/entity/${row.id}`);
    try {
      await p.waitForSelector('#main .doc-section[data-doc-field="Spec"]');
      await p.waitForSelector('#main .ref-outbound-card');
      const e = await entryPoints(p, '#main');
      assert.equal(e.toolbar, 1, 'the toolbar Activity button');
      assert.equal(e.docHistory, 0, 'no per-document History button');
      assert.deepEqual(e.named, ['btn btn-sm activity-btn'], `nothing else names activity (${e.named.join(', ')})`);
      assert.equal(e.sideTitles.some((t) => ACTIVITY.test(t)), false, `no Activity card (${e.sideTitles.join(', ')})`);
      assert.ok(e.sideTitles.some((t) => /^References/.test(t)), 'the References card stays without any Activity switch');
      await p.click('#main .eye-btn');
      await p.waitForSelector('.chip-pop .eye-row');
      assert.equal((await p.locator('.chip-pop .eye-label').allInnerTexts()).some((r) => ACTIVITY.test(r)), false, 'the record\'s show/hide has no Activity row');
      await closePop(p);
      await p.click('#main .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      assert.deepEqual(await p.locator('.wv-act-filters button[data-filter]').allTextContents(), ['All', 'Description', 'Spec', 'Fields'],
        'the panel filters by document, which the History button used to do');
    } finally { await p.close(); }
  });

  test('the peek beside the table has the same single entry point (Feature #315)', async () => {
    const p = await page(`#/table/${table.id}?e=${row.id}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) .doc-section[data-doc-field="Spec"]');
      const e = await entryPoints(p, '#dock');
      assert.equal(e.toolbar, 1);
      assert.equal(e.docHistory, 0);
      assert.deepEqual(e.named, ['btn btn-sm activity-btn'], `nothing else names activity (${e.named.join(', ')})`);
    } finally { await p.close(); }
  });

  test('the Activity system table stays: the left-nav row opens #/activity and a record\'s history (Feature #315)', async () => {
    const p = await page(`#/table/${table.id}`);
    try {
      await p.waitForSelector('.wv-grid tbody tr.entity-row');
      await p.click('.nav-system a[href="#/activity"]');
      await p.waitForFunction(() => location.hash === '#/activity');
      await p.waitForSelector('.activity-row');
      await p.goto(`${base}/#/activity/${row.id}`, { waitUntil: 'networkidle' });
      await p.waitForSelector('.activity-row');
      assert.ok(await p.locator('.activity-row').count() >= 4, 'the record\'s history lists in the system table');
    } finally { await p.close(); }
  });
}
