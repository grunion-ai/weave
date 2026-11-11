import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, notes, alpha, beta, gamma, aside;
const s = await launch('a record page applies the entity its save returned', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Done', type: 'checkbox' });
  weave.addField(tasks, { name: 'Label', type: 'formula', config: { expression: 'IF([Done], "Shipped", "Open")' } });
  weave.addField(tasks, { name: 'Notes', type: 'document' });
  [alpha, beta, gamma] = ['Alpha', 'Beta', 'Gamma'].map((name) => {
    const e = weave.createEntity(tasks, { name });
    weave.setDoc(e.id, `# ${name}\n\nThe brief.\n`);
    weave.setDoc(e.id, `${name} notes`, 'Notes');
    return e;
  });
  notes = weave.createTable({ space: 'Work', name: 'Memo' });
  weave.addField(notes, { name: 'Pinned', type: 'checkbox' });
  aside = weave.createEntity(notes, { name: 'Aside' });
});

if (s) {
  const { base, browser, weave } = s;
  const DOCS = (scope) => ['Description', 'Notes'].map((f) => `${scope} .doc-section[data-doc-field="${f}"] :is(.vditor-ir [contenteditable="true"], textarea.doc-source)`);
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };
  const watch = (page) => {
    const seen = [];
    page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (pathname.includes('/api/')) seen.push(`${r.method()} ${pathname.replace(/^.*?\/api\//, '/')}`);
    });
    return seen;
  };
  const keep = (page, selector) => page.evaluate((sel) => {
    window.__kept = [...document.querySelectorAll(sel)];
    return { count: window.__kept.length, editors: window.__weaveEditors.size };
  }, selector);
  const kept = (page) => page.evaluate(() => ({ connected: window.__kept.filter((n) => n.isConnected).length, editors: window.__weaveEditors.size }));
  const saved = (page, id) => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/entities/${id}`));
  const reads = (page, row, text) => page.waitForFunction(([sel, want]) => document.querySelector(sel)?.textContent.includes(want), [row, text], { timeout: 5000 });

  test('a field save on the record page sends one PATCH and no GET, and keeps every mounted editor (Issue #1681)', async () => {
    const page = await open(`#/entity/${alpha.id}`);
    try {
      for (const sel of DOCS('#main')) await page.waitForSelector(sel);
      const before = await keep(page, '#main .doc-section, #main .vditor, #main .fieldrow[data-field="Done"] input');
      assert.equal(before.editors, 2, 'both documents are mounted');
      const seen = watch(page);
      const landed = saved(page, alpha.id);
      await page.click('#main .fieldrow[data-field="Done"] input.form-check-input');
      await landed;
      await reads(page, '#main .fieldrow[data-field="Label"]', 'Shipped');
      assert.deepEqual(seen, [`PATCH /entities/${alpha.id}`], 'the save is the only request: the page draws the entity the PATCH returned');
      assert.deepEqual(await kept(page), { connected: before.count, editors: before.editors }, 'every document section, editor and the checkbox stay mounted');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.fieldrow[data-field="Done"] input')), true, 'and focus stays on the checkbox');
      assert.equal(weave.readEntity(alpha.id).fields.Done, true);
    } finally { await page.close(); }
  });

  test('a field save in the dock sends one PATCH, keeps the dock editors, and the grid row repaints from the saved event (Issue #1681)', async () => {
    const page = await open(`#/table/${tasks.id}`);
    try {
      await page.click(`tr[data-eid="${beta.id}"] .open-link`);
      for (const sel of DOCS('#dock')) await page.waitForSelector(sel);
      const before = await keep(page, '#dock .doc-section, #dock .vditor, #main > .table-wrap');
      const seen = watch(page);
      const landed = saved(page, beta.id);
      await page.click('#dock .fieldrow[data-field="Done"] input.form-check-input');
      await landed;
      await reads(page, '#dock .fieldrow[data-field="Label"]', 'Shipped');
      await reads(page, `tr[data-eid="${beta.id}"] td[data-field="Label"]`, 'Shipped');
      assert.equal(await page.$eval(`tr[data-eid="${beta.id}"] td[data-field="Done"] input`, (box) => box.checked), true, 'the grid row wears the saved value');
      assert.deepEqual(seen, [`PATCH /entities/${beta.id}`], 'one write, and neither the dock nor the grid reads anything back');
      assert.deepEqual(await kept(page), { connected: before.count, editors: before.editors }, 'the dock documents and the grid stay mounted');
    } finally { await page.close(); }
  });

  test('a cell edit repaints its row once, from the saved event (Issue #1681)', async () => {
    const page = await open(`#/table/${tasks.id}`);
    try {
      await page.waitForSelector(`tr[data-eid="${gamma.id}"] td[data-field="Done"] input`);
      await page.evaluate(() => {
        const wrap = document.querySelector('#main > .table-wrap');
        const patch = wrap.wvPatchRows;
        window.__repaints = 0;
        wrap.wvPatchRows = (...a) => { window.__repaints++; return patch(...a); };
      });
      const seen = watch(page);
      const landed = saved(page, gamma.id);
      await page.click(`tr[data-eid="${gamma.id}"] td[data-field="Done"] input`);
      await landed;
      await reads(page, `tr[data-eid="${gamma.id}"] td[data-field="Label"]`, 'Shipped');
      assert.equal(await page.evaluate(() => window.__repaints), 1, 'one repaint, not one from the cell and one from the queue');
      assert.deepEqual(seen, [`PATCH /entities/${gamma.id}`]);
    } finally { await page.close(); }
  });

  test('a dock save on a row the grid does not show leaves the grid alone (Issue #1681)', async () => {
    const page = await open(`#/table/${tasks.id}`);
    try {
      await page.waitForSelector(`tr[data-eid="${alpha.id}"]`);
      await page.evaluate((id) => {
        const a = Object.assign(document.createElement('a'), { href: `#/entity/${id}`, textContent: 'aside' });
        document.querySelector('#main').append(a);
        a.click();
        a.remove();
      }, aside.id);
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Pinned"] input');
      const before = await keep(page, '#main > .table-wrap, #main > .table-wrap tbody tr');
      const seen = watch(page);
      const landed = saved(page, aside.id);
      await page.click('#dock .fieldrow[data-field="Pinned"] input.form-check-input');
      await landed;
      await page.waitForFunction(() => document.querySelector('.save-glyph')?.dataset.state === 'saved', null, { timeout: 5000 });
      assert.deepEqual(seen, [`PATCH /entities/${aside.id}`], 'the grid neither re-reads nor redraws');
      assert.equal((await kept(page)).connected, before.count, 'every grid row is the one drawn before the save');
      assert.equal(weave.readEntity(aside.id).fields.Pinned, true);
    } finally { await page.close(); }
  });
}
