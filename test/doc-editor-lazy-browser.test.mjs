import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { HTML, ROUTED, read } from './lib/source.mjs';

const FILE = '/doc-editor.js';
const IS_FILE = /\/doc-editor\.js(\?|$)/;
let notes, row;
const s = await launch('doc editor lazy', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  row = weave.createEntity(notes, { name: 'Plan' });
  weave.setDoc(row.id, '# Plan\n\nFirst line of the plan.\n', 'Description');
});

test('the doc editor glue lives in doc-editor.js, and app.js keeps the loader, saves and rails (Issue #1041)', () => {
  const app = read('public/app.js');
  const glue = read(`public${FILE}`);
  for (const fn of ['mountDocEditor', 'slashRows', 'slashHint', 'entityHint', 'attachRefChips', 'refreshRefChips', 'uploadDocFiles', 'attachToolbarBubble', 'pickReference', 'applyCommandMarkers']) {
    assert.match(glue, new RegExp(`function ${fn}\\(`), `${fn} is in doc-editor.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
  for (const fn of ['loadVditor', 'scheduleDocSave', 'flushDocSaves', 'teardownDocEditors', 'attachDashRail', 'attachHeadingFolds', 'retheme']) {
    assert.match(app, new RegExp(`function ${fn}\\(`), `${fn} stays in app.js, which calls it at load`);
  }
  assert.match(app, /lazyScript\('\/doc-editor\.js'\)/, 'loadVditor fetches the glue beside Vditor');
  assert.match(HTML, /<template id="lazy-assets">[^]*?<script src="\/doc-editor\.js"><\/script>[^]*?<\/template>/, 'the server stamps its version');
  assert.ok(ROUTED.includes(`public${FILE}`), 'source readers see the moved code');
});

if (s) {
  const { base, browser } = s;

  test('a cold table paints its grid while the doc editor file is held (Issue #1041)', async () => {
    const page = await browser.newPage();
    try {
      let asked = false;
      await page.route(IS_FILE, () => { asked = true; });
      await page.goto(`${base}/#/table/${notes.id}`);
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assert.equal(await page.evaluate(() => typeof mountDocEditor), 'undefined', `the grid paints without the glue (requested: ${asked})`);
    } finally { await page.close(); }
  });

  test('a record page mounts its editor once the file arrives (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    try {
      let release;
      const held = new Promise((r) => { release = r; });
      const fetched = [];
      await page.route(IS_FILE, async (r) => { fetched.push(FILE); await held; await r.continue(); });
      await page.goto(`${base}/#/entity/${row.id}`);
      await page.locator('section.doc-section[data-doc-field="Description"]').waitFor({ state: 'attached' });
      await page.waitForFunction(() => 'Vditor' in window);
      assert.equal(await page.locator('.vditor-ir').count(), 0, 'no editor before its glue');
      release();
      await page.locator('.vditor-ir [contenteditable="true"]', { hasText: 'First line of the plan.' }).waitFor();
      assert.deepEqual(fetched, [FILE]);
    } finally { await page.close(); }
  });

  test('a record page whose doc editor file fails shows the source and says so (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    try {
      await page.route(IS_FILE, (r) => r.abort());
      await page.goto(`${base}/#/entity/${row.id}`);
      await page.locator('textarea.doc-source').waitFor();
      assert.match(await page.locator('textarea.doc-source').inputValue(), /First line of the plan\./);
      await page.locator('#wv-toasts', { hasText: 'The editor did not load' }).waitFor();
      assert.equal(await page.locator('.vditor-ir').count(), 0);
    } finally { await page.close(); }
  });
}
