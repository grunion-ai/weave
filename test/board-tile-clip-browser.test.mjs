import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, eventually } from './lib/browser.mjs';

const NAMES = [
  'Roll the Clerk live secret that landed in a transcript and confirm the old key is dead',
  'Ship the board tile loading clip fix with a browser regression test',
  'Write up the Railway cost model for production and the serverless option that was dropped',
  'Move the five iCloud git checkouts under a nosync path so fileproviderd stops syncing agent writes',
  'Confirm the Delaware registered agent renewal before the deadline',
];
let tasks;
const s = await launch('board tile clip', (weave) => {
  weave.createSpace({ name: 'Net' });
  tasks = weave.createTable({ space: 'Net', name: 'Tasks' });
  weave.addField(tasks.id, { name: 'State', type: 'workflow', config: { states: [
    { id: 'open', name: 'Open', category: 'not-started', default: true },
    { id: 'in-progress', name: 'In Progress', category: 'in-progress' },
    { id: 'review', name: 'Review', category: 'in-progress' },
    { id: 'done', name: 'Done', category: 'done' },
  ] } });
  for (let i = 0; i < 30; i++) weave.createEntity(tasks.id, { Name: `${NAMES[i % NAMES.length]} (${i + 1})`, State: 'Open' });
  for (let i = 0; i < 4; i++) weave.createEntity(tasks.id, { Name: `In progress task ${i + 1} with a name long enough to wrap`, State: 'In Progress' });
  for (let i = 0; i < 3; i++) weave.createEntity(tasks.id, { Name: `Review task ${i + 1}`, State: 'Review' });
  for (let i = 0; i < 6; i++) weave.createEntity(tasks.id, { Name: `Done task ${i + 1}`, State: 'Done' });
  weave.tableView(`${tasks.id}/Standard`, {
    layout: 'board', groups: 'side', picture: 'off', group: ['State'], fields: ['Name', 'State'],
    filters: { State: ['Open', 'In Progress', 'Review'] }, sort: [],
  });
});

if (s) {
  const { base, weave, browser } = s;
  const engines = async () => [['chromium', browser], ['webkit', await engineOf('webkit')]];
  const open = async (engine, { theme = 'light', groups = 'side' } = {}) => {
    weave.tableView(`${tasks.id}/Standard`, { groups });
    const page = await engine.newPage({ viewport: { width: 1373, height: 793 }, colorScheme: theme });
    await page.addInitScript(() => {
      const sizes = [];
      window.__tileSizes = sizes;
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) sizes.push({ eid: e.target.dataset.eid, h: e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height });
      });
      const seen = new WeakSet();
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          for (const t of n.querySelectorAll?.('.wv-board .tile') ?? []) if (!seen.has(t)) { seen.add(t); ro.observe(t); }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/tables/*/query', async (route) => { await new Promise((r) => setTimeout(r, 300)); await route.continue(); });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile');
    return page;
  };
  const clipped = (page) => page.evaluate(() => [...document.querySelectorAll('.wv-board .tile')].filter((t) => {
    const box = t.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(t.querySelector('.tile-title'));
    const name = range.getBoundingClientRect();
    return name.top < box.top - 0.5 || name.bottom > box.bottom + 0.5;
  }).map((t) => `${t.querySelector('.tile-id').textContent} ${Math.round(t.getBoundingClientRect().height)}px`));
  const resized = (page) => page.evaluate(() => {
    const last = new Map();
    for (const r of window.__tileSizes) last.set(r.eid, r.h);
    return window.__tileSizes.filter((r) => Math.abs(r.h - last.get(r.eid)) > 0.5).map((r) => `${r.eid.slice(0, 8)} ${Math.round(r.h)}px`);
  });

  test('every tile is laid out at its settled height from the first frame, with the name inside the tile, in both engines, themes and group layouts', async () => {
    for (const [name, engine] of await engines()) {
      for (const theme of ['light', 'dark']) for (const groups of ['side', 'stacked']) {
        const page = await open(engine, { theme, groups });
        assert.equal(await page.locator('.wv-board .tile').count(), 37, `${name} ${theme} ${groups}: tiles`);
        assert.deepEqual(await resized(page), [], `${name} ${theme} ${groups}: a tile was laid out at another height before it settled`);
        assert.deepEqual(await clipped(page), [], `${name} ${theme} ${groups}: a tile clips its name`);
        await page.close();
      }
    }
  });

  test('a tile keeps its own height when its row track comes out shorter than its content, so the name never clips to its descenders', async () => {
    for (const [name, engine] of await engines()) {
      for (const groups of ['side', 'stacked']) {
        const page = await open(engine, { groups });
        await page.evaluate(() => { for (const cards of document.querySelectorAll('.board-cards')) cards.style.gridAutoRows = '15px'; });
        assert.deepEqual(await eventually(() => clipped(page), []), [], `${name} ${groups}: tiles shrank to the 15px track and clipped their names`);
        await page.close();
      }
    }
  });
}
