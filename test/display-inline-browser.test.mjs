import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
let row, table, space, owner, reader, docId;
const html = '<!doctype html><style>body{margin:0;padding:12px;font:16px system-ui}#more{height:180px}</style><h2>Inline task content</h2><button onclick="document.getElementById(\'more\').hidden=!document.getElementById(\'more\').hidden">Expand example</button><div id="more" hidden>Extra detail</div>';
const s = await launch('display inline', w => {
  owner = w.createAccount({ name: 'owner', role: 'architect' }).token;
  reader = w.createAccount({ name: 'reader', role: 'observer' }).token;
  space = w.createSpace({ name: 'Demo' }).id;
  table = w.createTable({ space: 'Demo', name: 'Task' }).id;
  w.addField(table, { name: 'Audience', type: 'text' });
  docId = w.addField(table, { name: 'HTML document', type: 'document', config: { kind: 'html', displayInline: true } }).id;
  w.addField(table, { name: 'HTML file', type: 'attachments', config: { multiple: false, displayInline: true } });
  w.addField(table, { name: 'Empty document', type: 'document', config: { displayInline: true } });
  row = w.createEntity(table, { name: 'Inline example', values: { Audience: 'Readers', 'HTML document': html, Description: 'Normal description stays normal.' } }).id;
  w.attachToField(row, 'HTML file', { name: 'example.html', mime: 'text/html', bytes: Buffer.from(html) });
  for (const [registry, id] of [['System/Tables', table], ['System/Spaces', space]]) {
    w.addField(registry, { name: 'Inline guide', type: 'document', config: { kind: 'html', displayInline: true } });
    const record = w.query(registry, {}).items.find(r => r.sysId === id);
    w.addField(registry, { name: 'Written guide', type: 'document', config: { displayInline: true } });
    w.updateEntity(record.id, { 'Inline guide': html, 'Written guide': '## Written introduction\n\n**Native Markdown** with [a link](https://example.com).\n\n<script>document.title="unsafe"</script>' });
  }
  w.updateTable(table, { bodyOrder: ['HTML document', 'HTML file', '@values', 'Description', 'Empty document'] });
});
if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) test(`inline document and file render without headings at ${width} ${theme}`, async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${owner}` }, viewport: { width, height: 900 } });
    try {
      await page.addInitScript(t => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/e/${row}`);
      const doc = page.locator('[data-doc-field="HTML document"]');
      const frame = doc.locator('iframe');
      await frame.waitFor();
      await eventually(async () => (await frame.boundingBox()).height < 160, true);
      assert.equal(await doc.locator('.doc-section-head').isVisible(), false);
      assert.equal(await doc.locator('.doc-caret').count(), 0);
      assert.equal(await page.locator('.attachment-intro .file-viewer-bar').count(), 0);
      assert.equal(await page.locator('[data-doc-field="Description"] .doc-section-head').isVisible(), true);
      const short = (await frame.boundingBox()).height;
      await frame.contentFrame().getByRole('button', { name: 'Expand example' }).click();
      await eventually(async () => (await frame.boundingBox()).height > short + 150, true);
      assert.ok(!(await frame.getAttribute('sandbox')).includes('allow-same-origin'));
      assert.ok(await frame.evaluate(n => n.compareDocumentPosition(document.querySelector('.entity-values')) & Node.DOCUMENT_POSITION_FOLLOWING));
      await doc.getByText('Field options', { exact: true }).click();
      await doc.getByRole('button', { name: 'Edit HTML document source' }).click();
      await doc.locator('textarea').waitFor();
      assert.match(await doc.locator('textarea').inputValue(), /Inline task content/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally { await page.close(); }
  });
  test('observers see inline content without source editing or empty sections', async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${reader}` } });
    try {
      await page.goto(`${base}/e/${row}`);
      await page.locator('.document-inline iframe').waitFor();
      assert.equal(await page.locator('.document-inline-options:visible').count(), 0);
      assert.equal(await page.locator('[data-doc-field="Empty document"]').isVisible(), false);
    } finally { await page.close(); }
  });
  test('docked documents keep inline rendering and resize with interaction', async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${owner}` }, viewport: { width: 1600, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${table}`);
      await page.locator(`tr[data-eid="${row}"] .open-link`).click();
      const frame = page.locator('#dock .document-inline iframe');
      await frame.waitFor();
      await eventually(async () => (await frame.boundingBox()).height < 160, true);
      const height = (await frame.boundingBox()).height;
      await frame.contentFrame().getByRole('button', { name: 'Expand example' }).click();
      await eventually(async () => (await frame.boundingBox()).height > height + 150, true);
    } finally { await page.close(); }
  });
  for (const [kind, id] of [['table', table], ['space', space]]) test(`native inline document renders on ${kind} header`, async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${reader}` } });
    try {
      await page.goto(`${base}/#/${kind}/${id}`);
      const frame = page.locator('.registry-intro.document-inline iframe');
      await frame.waitFor();
      await frame.contentFrame().getByRole('heading', { name: 'Inline task content' }).waitFor();
      await eventually(async () => (await frame.boundingBox()).height < 160, true);
      assert.equal(await page.locator('.registry-intro .intro-controls:visible').count(), 0);
      await page.getByRole('heading', { name: 'Written introduction' }).waitFor();
      assert.equal(await page.locator('.registry-intro script').count(), 0);
      assert.notEqual(await page.title(), 'unsafe');
    } finally { await page.close(); }
  });
  test('inline rendering leaves source downloads unchanged and retains the HTML sandbox', async () => {
    const headers = { Authorization: `Bearer ${owner}` };
    const path = `${base}/e/${row}/doc/${encodeURIComponent('HTML document')}`;
    assert.equal(await (await fetch(`${path}.md`, { headers })).text(), html);
    assert.equal(await (await fetch(`${path}.html`, { headers })).text(), html);
    const inline = await fetch(`${path}.html?inline=1`, { headers });
    assert.match(inline.headers.get('Content-Security-Policy'), /sandbox/);
    assert.match(await inline.text(), /frame-height/);
  });
  test('field dialog switches inline display off without changing content or order', async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${owner}` } });
    try {
      await page.goto(`${base}/e/${row}`);
      const doc = page.locator('[data-doc-field="HTML document"]');
      await doc.getByText('Field options', { exact: true }).click();
      await doc.getByRole('button', { name: 'Field settings', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Display inline', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await eventually(async () => await page.locator('[data-doc-field="HTML document"] .doc-section-head').isVisible(), true);
      const entity = await (await fetch(`${base}/api/entities/${row}`, { headers: { Authorization: `Bearer ${owner}` } })).json();
      assert.equal(entity.docs['HTML document'], html);
    } finally { await page.close(); }
  });
}
