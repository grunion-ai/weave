import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let intro, ordinary, old;
const s = await launch('introduction replacement', (w) => {
  w.createSpace({ name: 'Docs' });
  const table = w.createTable({ space: 'Docs', name: 'Page' });
  w.addField(table, { name: 'Introduction', type: 'attachments', config: { multiple: false, preview: 'intro' } });
  w.updateTable(table.id, { bodyOrder: ['Introduction', '@values', 'Description'] });
  intro = w.createEntity(table, { name: 'Versioned introduction' });
  old = w.attachToField(intro.id, 'Introduction', { name: 'old.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><p>Earlier introduction</p>') });
  const normal = w.createTable({ space: 'Docs', name: 'Note' });
  ordinary = w.createEntity(normal, { name: 'Ordinary HTML attachment' });
  w.attachFile(ordinary.id, { name: 'loose.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><p>Ordinary live HTML</p>') });
});

if (s) {
  const { base, browser } = s;
  test('replacing an introduction keeps one live body and an accessible old file chip', async () => {
    const response = await fetch(`${base}/api/entities/${intro.id}/fields/Introduction/files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new.html', mime: 'text/html', contentBase64: Buffer.from('<!doctype html><p>Current introduction</p>').toString('base64') }),
    });
    assert.equal(response.status, 201);
    const current = await response.json();
    const saved = await (await fetch(`${base}/api/entities/${intro.id}`)).json();
    assert.deepEqual(saved.raw.Introduction, [current.id]);
    assert.deepEqual(saved.files.map(f => f.id).sort(), [old.id, current.id].sort());
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${intro.id}`);
      await page.locator('.attachment-intro iframe').waitFor();
      assert.equal(await page.locator('.entity-body iframe').count(), 1);
      assert.match(await page.locator('.attachment-intro iframe').getAttribute('src'), new RegExp(current.id));
      assert.equal(await page.locator('.entity-files-page').count(), 0);
      const previous = page.locator('.entity-files-card .attach-item a:text-is("old.html")');
      await previous.click();
      const archived = page.locator('#side .wv-file-panel iframe');
      await archived.waitFor();
      assert.match(await archived.getAttribute('src'), new RegExp(old.id));
      assert.equal(await archived.contentFrame().locator('p').textContent(), 'Earlier introduction');
      if (process.env.WEAVE_DOCS_SCREENSHOTS) await page.screenshot({ path: `${process.env.WEAVE_DOCS_SCREENSHOTS}/replaced-introduction.png`, fullPage: true });
    } finally { await page.close(); }
  });
  test('ordinary tables still automatically render loose HTML files', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${ordinary.id}`);
      const frame = page.locator('.entity-files-page iframe');
      await frame.waitFor();
      assert.equal(await frame.contentFrame().locator('p').textContent(), 'Ordinary live HTML');
      assert.equal(await page.locator('.entity-files-card .attach-item a:text-is("loose.html")').count(), 1);
    } finally { await page.close(); }
  });
  test('hiding an introduction field does not turn its archived HTML into a second body', async () => {
    s.weave.updateTable(intro.dbId, { hiddenFields: ['Introduction'] });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${intro.id}`);
      await page.locator('.entity-files-card .attach-item a:text-is("old.html")').waitFor();
      assert.equal(await page.locator('.entity-body iframe').count(), 0);
    } finally { await page.close(); }
  });
}
