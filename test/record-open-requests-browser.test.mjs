import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, alpha;
const s = await launch('opening a record reads only what it draws', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'document' });
  weave.addField(tasks, { name: 'Brief', type: 'document' });
  alpha = weave.createEntity(tasks, { name: 'Alpha' });
  for (const [field, text] of [[null, '# Alpha\n\nThe plan.\n'], ['Notes', 'Alpha notes'], ['Brief', 'Alpha brief']]) weave.setDoc(alpha.id, text, field);
});

if (s) {
  const { base, browser } = s;
  test('opening a record sends no revision GET per document field (Issue #1691)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      const revisions = [];
      page.on('request', (r) => { if (/\/doc\/revisions/.test(new URL(r.url()).pathname)) revisions.push(r.url()); });
      await page.click(`tr[data-eid="${alpha.id}"] .open-link`);
      for (const f of ['Description', 'Notes', 'Brief']) {
        await page.waitForSelector(`#dock .doc-section[data-doc-field="${f}"] :is(.vditor-ir [contenteditable="true"], textarea.doc-source)`);
      }
      assert.deepEqual(revisions, [], 'the record opens without reading any document history');
    } finally { await page.close(); }
  });
}
