import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone next-state action', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  const light = weave.createEntity(issues, { name: 'Light one', values: { Status: 'Open' } });
  const dark = weave.createEntity(issues, { name: 'Dark one', values: { Status: 'Open' } });
  const done = weave.createEntity(issues, { name: 'Done one', values: { Status: 'Fixed' } });
  const notes = weave.createTable({ space: 'Development', name: 'Note' });
  const note = weave.createEntity(notes, { name: 'A note' });
  const at = (t, e) => `#/table/${t.id}?e=${e.id}`;
  return { rows: { light: [light.id, at(issues, light)], dark: [dark.id, at(issues, dark)] }, done: at(issues, done), note: at(notes, note) };
});

if (s) {
  const { base, browser, rows, done, note } = s;
  const open = async (hash, { width, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
    return page;
  };
  const fab = (page) => page.evaluate(() => {
    const b = document.querySelector('.next-state-fab');
    if (!b || !b.getClientRects().length || getComputedStyle(b).display === 'none') return null;
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { text: b.textContent.trim(), left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height, onTop: !!hit?.closest('.next-state-fab'), vh: innerHeight, theme: document.documentElement.dataset.bsTheme, fill: getComputedStyle(b).backgroundColor };
  });
  const status = (page, id) => page.evaluate(async (id) => (await (await fetch(`/api/entities/${id}`)).json()).fields.Status, id);

  for (const theme of ['light', 'dark']) {
    test(`on a phone the row page floats a button that moves the row to its next state (${theme}, Feature #273)`, async () => {
      const [id, hash] = rows[theme];
      const page = await open(hash, { theme });
      try {
        let b = await fab(page);
        assert.ok(b, 'the next-state button shows');
        assert.equal(b.theme, theme);
        assert.equal(b.text, 'Move to In Progress');
        assert.ok(b.height >= 44 && b.width >= 300, `it is a wide ${b.width}x${b.height} button`);
        assert.ok(b.vh - b.bottom >= 8 && b.vh - b.bottom <= 40, `pinned near the bottom (${b.vh - b.bottom}px up)`);
        assert.ok(b.onTop, 'nothing covers it');
        await page.click('.next-state-fab');
        assert.equal(await eventually(() => status(page, id), 'In Progress'), 'In Progress', 'the row moves on');
        await page.waitForFunction(() => document.querySelector('.next-state-fab')?.textContent.trim() === 'Move to Fixed');
        b = await fab(page);
        assert.equal(b.text, 'Move to Fixed', 'and the button offers the state after that');
      } finally { await page.close(); }
    });
  }

  test('on a phone a row in its last state or in a table with no workflow has no next-state button (Feature #273)', async () => {
    for (const hash of [done, note]) {
      const page = await open(hash);
      try { assert.equal(await fab(page), null, hash); } finally { await page.close(); }
    }
  });

  test('on a desktop the row pane shows no next-state button (Feature #273)', async () => {
    const page = await open(rows.light[1], { width: 1280 });
    try { assert.equal(await fab(page), null); } finally { await page.close(); }
  });
}
