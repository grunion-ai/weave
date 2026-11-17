import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, engineOf } from './lib/browser.mjs';
const AWAY = 'https://elsewhere.test/away';
const PAGE = Buffer.from(`<!doctype html><html><body><p id="p">report</p><a id="away" href="${AWAY}">away</a> <a id="blank" href="${AWAY}" target="_blank">blank</a> <button id="pop" onclick="window.open('${AWAY}')">pop</button> <button id="forge" onclick="parent.postMessage({ weave: 'frame-link', href: 'javascript:alert(1)' }, '*')">forge</button> <a id="jump" href="#end">jump</a> <a id="top" href="#">top</a><div style="height:3000px"></div><h2 id="end">end</h2></body></html>`);
let row, file;
const s = await launch('plain links in a previewed html file', (weave) => {
  weave.createSpace({ name: 'Reports' });
  const reports = weave.createTable({ space: 'Reports', name: 'Report' });
  weave.addField(reports, { name: 'Files', type: 'attachments' });
  row = weave.createEntity(reports, { name: 'row' });
  file = weave.attachToField(row.id, 'Files', { name: 'report.html', mime: 'text/html', bytes: PAGE });
});

if (s) {
  const { base, browser } = s;
  const panel = '#side .wv-file-panel';
  const originOf = (opened) => opened.evaluate(() => { try { localStorage.length; return origin; } catch { return 'no storage'; } });
  const ENGINES = ['chromium', 'webkit'];
  async function openPanel(engine = browser) {
    const page = await engine.newPage({ viewport: { width: 1400, height: 900 } });
    await page.context().route('https://elsewhere.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>away</p>' }));
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.click('.attach-block[data-block="Files"] .attach-chips .attach-item a:text-is("report.html")');
    const inner = await (await page.waitForSelector(`${panel} iframe`)).contentFrame();
    await inner.waitForSelector('#away');
    return { page, inner };
  }

  for (const name of ENGINES) {
    for (const link of ['#away', '#blank']) {
      test(`${name}: a ${link} link inside a previewed HTML file opens a new tab outside the sandbox and the panel keeps the file (Issue #1475, Issue #1433)`, async () => {
        const { page, inner } = await openPanel(await engineOf(name));
        try {
          const popup = page.context().waitForEvent('page');
          await inner.click(link);
          const opened = await popup;
          await opened.waitForLoadState();
          assert.equal(opened.url(), AWAY, 'the link opens in a new page');
          assert.equal(await originOf(opened), 'https://elsewhere.test', 'the destination runs as itself, with its own origin and storage');
          assert.equal(await opened.evaluate(() => opener), null, 'the destination holds no handle on weave');
          assert.match(await page.locator(`${panel} iframe`).getAttribute('src'), new RegExp(`/api/files/${file.id}\\?view$`));
          assert.ok(inner.url().endsWith(`/api/files/${file.id}?view`), 'the frame never left the file');
          assert.equal(await inner.evaluate(() => document.getElementById('p').textContent), 'report', 'the panel still shows the file');
        } finally { await page.close(); }
      });
    }
    test(`${name}: a window opened by script inside a previewed HTML file stays in the sandbox (Issue #1433)`, async () => {
      const { page, inner } = await openPanel(await engineOf(name));
      try {
        const popup = page.context().waitForEvent('page');
        await inner.click('#pop');
        const opened = await popup;
        await opened.waitForLoadState();
        assert.equal(opened.url(), AWAY);
        assert.equal(await opened.evaluate(() => origin), 'null', 'the new window has an opaque origin');
        assert.equal(await originOf(opened), 'no storage', 'the new window cannot reach the storage of the site it loaded');
      } finally { await page.close(); }
    });
  }
  test('the app opens only http and https addresses for a frame, and only for its own HTML frames (Issue #1433)', async () => {
    const { page, inner } = await openPanel();
    try {
      const pages = [];
      page.context().on('page', (p) => pages.push(p.url()));
      await page.evaluate(() => { window.opens = []; const open = window.open; window.open = (...a) => { window.opens.push(a); return open(...a); }; });
      await inner.click('#forge');
      await page.evaluate((href) => postMessage({ weave: 'frame-link', href }, '*'), AWAY);
      await inner.evaluate(() => new Promise((done) => { addEventListener('message', done, { once: true }); postMessage(0, '*'); }));
      await page.evaluate(() => new Promise((done) => { addEventListener('message', (e) => e.data === 'drained' && done()); postMessage('drained', '*'); }));
      assert.deepEqual(await page.evaluate(() => window.opens), [], 'neither a javascript: address nor a message from outside a file frame opens anything');
      assert.deepEqual(pages, []);
    } finally { await page.close(); }
  });
  test('an in-page #anchor link inside a previewed HTML file stays in the panel (Issue #1475)', async () => {
    const { page, inner } = await openPanel();
    try {
      const pages = [];
      page.context().on('page', (p) => pages.push(p.url()));
      await inner.evaluate(() => { window.kept = true; });
      await inner.click('#jump');
      assert.equal(await eventually(() => inner.evaluate(() => location.hash), '#end'), '#end', 'the anchor moves the frame to #end in place');
      await inner.click('#top');
      assert.equal(await eventually(() => inner.evaluate(() => location.href.endsWith('#')), true), true, 'a bare # stays in place too');
      assert.equal(await inner.evaluate(() => window.kept), true, 'the same document, never a reload');
      assert.deepEqual(pages, [], 'no new tab for an anchor');
    } finally { await page.close(); }
  });
}
