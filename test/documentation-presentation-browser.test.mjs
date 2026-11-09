import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, eventually } from './lib/browser.mjs';

const svg = readFileSync(new URL('../brand/kit/svg/poster-contour-banner.svg', import.meta.url));
let ids, observer, owner;
const s = await launch('documentation presentation', (w) => {
  owner = w.createAccount({ name: 'owner', role: 'architect' }).token;
  observer = w.createAccount({ name: 'reader', role: 'observer' }).token;
  const space = w.createSpace({ name: 'Documentation', template: true });
  const table = w.createTable({ space: space.id, name: 'Page' });
  const plain = w.createTable({ space: space.id, name: 'Ordinary' });
  for (const t of [table, 'System/Tables', 'System/Spaces']) {
    w.addField(t, { name: 'Header', type: 'attachments', config: { multiple: false, preview: 'cover' } });
    w.addField(t, { name: 'Introduction', type: 'attachments', config: { multiple: false, preview: 'intro' } });
  }
  w.addField(table, { name: 'Audience', type: 'text' });
  w.updateTable(table.id, { bodyOrder: ['Introduction', '@values', 'Description', 'Header'] });
  const row = w.createEntity(table, { name: 'Documentation example', values: { Audience: 'People and agents' } });
  const destination = w.createEntity(table, { name: 'Native guide destination' });
  const html = Buffer.from(`<!doctype html><style>:root{color-scheme:light dark}body{background:#fff;color:#18212f;margin:0;font:16px/1.5 system-ui;padding:20px;box-sizing:border-box}button,a{padding:10px}#steps{height:250px}@media(prefers-color-scheme:dark){body{background:#181b21;color:#edf0f4}}p{margin:0 0 12px}</style><p>Explore connected records and connect your agent.</p><button onclick="document.getElementById('steps').hidden=!document.getElementById('steps').hidden">Setup steps</button><a href="/e/${destination.id}">Open native guide</a><div id="steps" hidden>Configure your client.</div><script>try{parent.document;document.title='unsafe'}catch{document.title='isolated'}</script>`);
  const tableRow = w.query('System/Tables', {}).items.find(r => r.sysId === table.id);
  const spaceRow = w.query('System/Spaces', {}).items.find(r => r.sysId === space.id);
  const files = {};
  for (const r of [row, tableRow, spaceRow]) {
    w.attachToField(r.id, 'Header', { name: 'weave rope banner.svg', mime: 'image/svg+xml', bytes: svg });
    files[r.id] = w.attachToField(r.id, 'Introduction', { name: 'introduction.html', mime: 'text/html', bytes: html });
  }
  ids = { row: row.id, table: table.id, space: space.id, tableRow: tableRow.id, spaceRow: spaceRow.id, plain: plain.id, destination: destination.id, files };
});

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    test(`native record introduction, secure resizing and complete cover at ${width} ${theme}`, async () => {
      const page = await browser.newPage({ colorScheme: null, extraHTTPHeaders: { Authorization: `Bearer ${owner}` }, viewport: { width, height: 900 } });
      try {
        await page.addInitScript(t => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/e/${ids.row}`);
        const frame = page.locator('.attachment-intro iframe');
        await frame.waitFor();
        const inner = await frame.contentFrame();
        await inner.locator('button').waitFor();
        assert.equal(await inner.locator('body').evaluate(() => document.title), 'isolated');
        assert.equal(await inner.locator('body').evaluate(n => getComputedStyle(n).backgroundColor), theme === 'dark' ? 'rgb(24, 27, 33)' : 'rgb(255, 255, 255)');
        assert.equal(await page.locator('.attachment-intro .file-viewer-bar').count(), 0);
        assert.equal(await page.locator('.entity-files-card').count(), 0);
        await page.locator('.intro-controls').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.intro-controls').getAttribute('open'), null);
        const img = page.locator('.entity-cover img');
        await page.waitForFunction(() => document.querySelector('.entity-cover img')?.naturalWidth > 0);
        const shape = await img.evaluate(n => [n.clientWidth / n.clientHeight, n.naturalWidth / n.naturalHeight]);
        assert.ok(Math.abs(shape[0] - shape[1]) < 0.1, 'whole banner retains its aspect ratio');
        await eventually(async () => (await frame.boundingBox()).height < 200, true);
        const short = (await frame.boundingBox()).height;
        await inner.locator('button').click();
        await eventually(async () => (await frame.boundingBox()).height > short + 200, true);
        await inner.locator('button').click();
        await eventually(async () => Math.abs((await frame.boundingBox()).height - short) < 3, true);
        await page.evaluate(() => window.postMessage({ weave: 'frame-height', height: 19000 }, '*'));
        assert.ok((await frame.boundingBox()).height < 200, 'untrusted source cannot resize frame');
        assert.ok(await frame.evaluate(n => n.compareDocumentPosition(document.querySelector('.entity-values')) & Node.DOCUMENT_POSITION_FOLLOWING));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const popup = page.waitForEvent('popup');
        await inner.locator('a').click();
        const opened = await popup;
        await opened.waitForURL(`**/e/${ids.destination}*`);
        assert.match(opened.url(), new RegExp(ids.destination));
        await opened.close();
        if (process.env.WEAVE_DOCS_SCREENSHOTS) await page.screenshot({ path: `${process.env.WEAVE_DOCS_SCREENSHOTS}/record-${width}-${theme}.png`, fullPage: true });
      } finally { await page.close(); }
    });
  }
  for (const width of [1440, 390]) for (const [kind, key] of [['table', 'table'], ['space', 'space'], ['entity', 'tableRow'], ['entity', 'spaceRow']]) {
    test(`registry presentation on ${kind} ${key} at ${width} stays outside the HTML`, async () => {
      const page = await browser.newPage({ colorScheme: null, extraHTTPHeaders: { Authorization: `Bearer ${owner}` }, viewport: { width, height: 900 } });
      try {
        await page.goto(`${base}/#/${kind}/${ids[key]}`);
        await page.locator('.entity-cover img').waitFor();
        await page.locator('.attachment-intro iframe').waitFor();
        assert.equal(await page.locator('.entity-cover').count(), 1);
        assert.equal(await page.locator('.attachment-intro iframe').count(), 1);
        assert.ok(await page.locator('.entity-cover').evaluate(n => n.compareDocumentPosition(document.querySelector('.attachment-intro')) & Node.DOCUMENT_POSITION_FOLLOWING));
        if (process.env.WEAVE_DOCS_SCREENSHOTS) await page.screenshot({ path: `${process.env.WEAVE_DOCS_SCREENSHOTS}/${kind}-${key}-${width}.png`, fullPage: true });
      } finally { await page.close(); }
    });
  }
  test('docked introductions use the same secure expanding frame', async () => {
    const page = await browser.newPage({ colorScheme: null, extraHTTPHeaders: { Authorization: `Bearer ${owner}` }, viewport: { width: 1600, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${ids.table}`);
      await page.locator(`tr[data-eid="${ids.row}"] .open-link`).click();
      const frame = page.locator('#dock .attachment-intro iframe');
      await frame.waitFor();
      const inner = frame.contentFrame();
      await eventually(async () => (await frame.boundingBox()).height < 250, true);
      const height = (await frame.boundingBox()).height;
      await inner.locator('button').click();
      await eventually(async () => (await frame.boundingBox()).height > height + 200, true);
      await inner.locator('button').click();
      await eventually(async () => Math.abs((await frame.boundingBox()).height - height) < 3, true);
      assert.equal(await page.locator('#dock .entity-cover').count(), 1);
    } finally { await page.close(); }
  });
  test('observers can read introductions but do not see editing controls', async () => {
    const page = await browser.newPage({ extraHTTPHeaders: { Authorization: `Bearer ${observer}` } });
    try {
      await page.goto(`${base}/e/${ids.row}`);
      await page.locator('.attachment-intro iframe').waitFor();
      assert.equal(await page.locator('.intro-controls').isVisible(), false);
      await page.goto(`${base}/#/table/${ids.table}`);
      await page.locator('.registry-intro iframe').waitFor();
      assert.equal(await page.locator('.intro-controls').isVisible(), false);
    } finally { await page.close(); }
  });
  test('table renames retain registry presentation and introductions follow stored block order', async () => {
    const patch = (path, value, method = 'PATCH') => fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner}` }, body: JSON.stringify(value) }).then(async r => { assert.ok(r.ok, await r.clone().text()); return r.json(); });
    const schema = await (await fetch(`${base}/api/schema`)).json();
    const registry = schema.flatMap(s => s.tables).find(t => t.system === 'tables');
    await patch(`/tables/${registry.id}/fields`, { name: 'Welcome', type: 'attachments', config: { multiple: false, preview: 'intro' } }, 'POST');
    await patch(`/entities/${ids.tableRow}/fields/Welcome/files`, { name: 'welcome.html', mime: 'text/html', contentBase64: Buffer.from('<!doctype html><p>Second introduction first</p>').toString('base64') }, 'POST');
    await patch(`/tables/${registry.id}`, { bodyOrder: ['Welcome', 'Introduction', '@values', 'Header'] });
    await patch(`/tables/${ids.table}`, { name: 'Renamed page' });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${ids.table}`);
      await page.locator('.registry-intro').nth(1).waitFor();
      assert.deepEqual(await page.locator('.registry-intro').evaluateAll(ns => ns.map(n => n.getAttribute('aria-label'))), ['Welcome', 'Introduction']);
      assert.equal(await page.locator('.registry-cover').count(), 1);
    } finally { await page.close(); }
  });
  test('non-HTML intro attachments retain their normal field settings and drag grip', async () => {
    const row = s.weave.createEntity(ids.table, { name: 'Plain attachment' });
    s.weave.attachToField(row.id, 'Introduction', { name: 'notes.txt', mime: 'text/plain', bytes: Buffer.from('A plain note') });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${row.id}`);
      const block = page.locator('.attach-block[data-block="Introduction"]');
      await block.locator('.file-viewer-bar').waitFor();
      assert.equal(await block.locator('.fieldrow-label').isVisible(), true);
      assert.notEqual(await block.locator(':scope > .opt-grip').evaluate(n => getComputedStyle(n).display), 'none');
      assert.equal(await block.locator('.intro-controls').count(), 0);
      await block.locator('.fieldrow-label').click();
      await page.locator('#modal-back, #tray-back').waitFor();
    } finally { await page.close(); }
  });
  test('unsigned readers cannot see intro edit controls in a workspace with accounts', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${ids.row}`);
      await page.locator('.attachment-intro iframe').waitFor();
      assert.equal(await page.locator('.intro-controls').isVisible(), false);
    } finally { await page.close(); }
  });
  test('unconfigured tables keep their existing presentation', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${ids.plain}`);
      await page.locator('.view-header').waitFor();
      assert.equal(await page.locator('.registry-cover, .registry-intro').count(), 0);
    } finally { await page.close(); }
  });
}
