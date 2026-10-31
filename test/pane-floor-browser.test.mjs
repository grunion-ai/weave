import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { closePane, openPane } from './lib/view-pane.mjs';
let issues, row;
const s = await launch('side panes hold their floors beside a docked entity (Issue #1286)', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium'] } });
  weave.addField(issues, { name: 'Area', type: 'text' });
  row = weave.createEntity(issues, { name: 'Error: signed-out workspace link opens a blank page with no sign-in prompt', values: { Severity: 'Medium', Area: 'Layout' } });
  for (let i = 0; i < 12; i++) weave.createEntity(issues, { name: `Issue ${i} with a long enough name to fill the table`, values: { Severity: 'Low', Area: 'Layout' } });
});
if (s) {
  const FLOORS = { '#main': 320, '#share-pane': 340, '#dock': 360, '#side': 300, '#view-pane': 320 };
  const layout = (page) => page.evaluate((floors) => {
    const shown = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none';
    const panes = Object.entries(floors).filter(([sel]) => shown(document.querySelector(sel))).map(([sel, floor]) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { sel, floor, left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) };
    });
    const name = document.querySelector('#dock textarea.name-edit');
    const cs = getComputedStyle(name);
    const lines = Math.round((name.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight));
    const app = document.querySelector('#app');
    return { panes, lines, words: name.value.trim().split(/\s+/).length, overflow: app.scrollWidth - app.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
  }, FLOORS);
  const holds = async (page, label) => {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const got = await layout(page);
    const where = `${label}: ${got.panes.map((p) => `${p.sel} ${p.left}+${p.width}`).join(', ')}`;
    assert.ok(got.panes.some((p) => p.sel === '#dock'), `${where}: the entity pane is showing`);
    for (const p of got.panes) assert.ok(p.width >= p.floor, `${where}: ${p.sel} is ${p.width}px, under its ${p.floor}px floor`);
    assert.ok(got.overflow <= 0 && got.page <= 0, `${where}: the pane row runs ${got.overflow}px past the window`);
    for (const p of got.panes) assert.ok(p.right <= page.viewportSize().width, `${where}: ${p.sel} ends past the window`);
    assert.ok(got.lines < got.words, `${where}: the record title stands on ${got.lines} lines for ${got.words} words`);
  };
  for (const width of [1280, 1580]) {
    for (const stored of [null, 900]) {
      test(`${width}px${stored ? `, entity pane pinned to ${stored}px` : ''}: table, entity, View, Activity and Share panes never squeeze a pane under its floor (Issue #1286)`, async () => {
        const page = await s.browser.newPage({ viewport: { width, height: 900 } });
        if (stored) await page.addInitScript((v) => { try { localStorage.setItem('wv-dock-width', String(v)); } catch {} }, stored);
        try {
          await page.goto(`${s.base}/#/table/${issues.id}?e=${row.id}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          await holds(page, 'table and entity pane');
          await openPane(page, 'filters');
          await holds(page, 'table, entity and View pane');
          await closePane(page);
          await page.click('#dock .activity-btn');
          await page.waitForSelector('#side:not([hidden]) aside.wv-activity');
          await holds(page, 'with Activity open');
          if (await page.locator('#main .table-view-btn').isVisible()) {
            await openPane(page, 'filters');
            await holds(page, 'with Activity and View open');
            await closePane(page);
          }
          await page.click('#dock .activity-btn');
          await page.waitForSelector('#side', { state: 'hidden' });
          await holds(page, 'Activity closed again');
          await page.click('#main .table-share-btn');
          await page.waitForSelector('#share-pane:not([hidden])');
          await holds(page, 'with Share open');
          await page.click('#share-pane [aria-label="Close share panel"]');
          await page.waitForSelector('#share-pane', { state: 'hidden' });
          await page.click('#dock .dock-close');
          await page.waitForSelector('#dock', { state: 'hidden' });
          const main = await page.$eval('#main', (e) => ({ shown: getComputedStyle(e).display !== 'none', width: e.getBoundingClientRect().width }));
          assert.ok(main.shown && main.width > 320, `closing the entity pane hands the table its width back (${main.width}px)`);
        } finally { await page.close(); }
      });
    }
  }
}
