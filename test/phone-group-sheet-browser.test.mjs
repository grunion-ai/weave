import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile, settled, atRest, PHONE } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone group sheet', (weave) => {
  weave.createSpace({ name: 'Plans' });
  const todo = weave.createTable({ space: 'Plans', name: 'To-do' });
  weave.addField(todo.id, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(todo.id, { name: 'Area', type: 'select', config: { options: ['Home', 'Work'] } });
  for (let i = 0; i < 4; i++) weave.createEntity(todo.id, { name: `Task ${i}`, values: { Severity: i % 2 ? 'High' : 'Low', Area: i < 2 ? 'Home' : 'Work' } });
  weave.tableView(`${todo.id}/Standard`, { layout: 'board', group: [{ field: 'Severity' }, { field: 'Area' }] });
  return { list: `#/table/${todo.id}`, id: todo.id };
});

if (s) {
  const { base, browser, list, id } = s;
  const engines = [];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push([`webkit ${PHONE}`, webkit, IPHONE]);
  engines.push(['chromium 390x844 touch', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]);

  const open = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${list}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .wv-board');
    return page;
  };
  const box = (page, selector) => page.evaluate((q) => {
    const n = document.querySelector(q);
    if (!n || !n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') return null;
    const r = n.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, height: Math.round(r.height), text: n.innerText.trim(), vw: document.documentElement.clientWidth, vh: innerHeight };
  }, selector);

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the sliders sheet holds a Group row that opens the group levels as a bottom sheet (${engine}, ${theme}, Issue #809)`, async () => {
        const page = await open(b, profile, theme);
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          await page.click('#main .table-tools-btn');
          await settled(page.locator('#main .crumb-actions'));
          const row = await box(page, '#main .crumb-actions .table-group-btn');
          assert.ok(row, 'the sheet shows a Group row');
          assert.ok(row.height >= 44, `a ${row.height}px target`);
          assert.match(row.text, /^Group/, `labelled Group: ${row.text}`);
          assert.ok(row.left >= 0 && row.right <= row.vw, 'inside the screen');
          await page.click('#main .crumb-actions .table-group-btn');
          await page.waitForSelector('.table-group-popover .group-level');
          await atRest(page.locator('.table-group-popover'));
          const pop = await box(page, '.table-group-popover');
          assert.ok(pop, 'the group popover opens');
          assert.ok(Math.abs(pop.bottom - pop.vh) <= 1, `pinned to the bottom edge (${pop.bottom} of ${pop.vh})`);
          assert.ok(pop.left <= 0.5 && pop.right >= pop.vw - 0.5, `full width (${pop.left}..${pop.right} of ${pop.vw})`);
          assert.equal(await page.locator('.table-group-popover .group-level').count(), 2, 'with both levels');
          const grip = await box(page, '.table-group-popover .group-level .group-grip');
          assert.ok(grip, 'the level reorder grip shows');
          await page.click('.table-group-popover .group-remove >> nth=1');
          await page.waitForFunction(async (tid) => {
            const t = (await (await fetch('/api/schema')).json()).flatMap((sp) => sp.tables).find((x) => x.id === tid);
            return (t.views ?? []).find((v) => v.name === 'Standard')?.group?.length === 1;
          }, id, { timeout: 10000 });
          await page.click('.table-group-popover .table-control-head button');
          await page.waitForSelector('.table-group-popover', { state: 'detached' });
        } finally {
          await page.evaluate(async (tid) => {
            const t = (await (await fetch('/api/schema')).json()).flatMap((sp) => sp.tables).find((x) => x.id === tid);
            const v = (t.views ?? []).find((x) => x.name === 'Standard');
            await fetch(`/api/tables/${tid}/views/${v.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group: [{ field: 'Severity' }, { field: 'Area' }] }) });
          }, id).catch(() => {});
          await page.close();
        }
      });
    }
  }

  test('on a desktop the group levels live in the View pane, beside the table (Issue #809, Feature #340)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 900 } }, 'light');
    try {
      assert.equal(await page.locator('#main .table-group-btn').isVisible(), false, 'no Group button in the desktop toolbar');
      await openPane(page, 'group');
      await page.waitForSelector('#view-pane .group-level');
      const main = await box(page, '#main');
      const pane = await box(page, '#view-pane');
      assert.ok(pane.left >= main.right, `the pane sits right of the main panel (${pane.left} vs ${main.right})`);
      assert.equal(await page.locator('#view-pane .group-level').count(), 2, 'with both levels');
    } finally { await page.close(); }
  });
}
