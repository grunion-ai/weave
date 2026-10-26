import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goFETs3n475pwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'base64');
const HTML = Buffer.from('<!doctype html><p id="p">page</p><script>document.getElementById("p").textContent = "ran"; try { parent.document; document.title = "reached"; } catch { document.title = "blocked"; }</script>');
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

let row, files;
const s = await launch('attachment previews', (weave) => {
  weave.createSpace({ name: 'Product' });
  const deck = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(deck, { name: 'Files', type: 'attachments' });
  weave.addField(deck, { name: 'Page', type: 'attachments', config: { multiple: false } });
  weave.addField(deck, { name: 'Hero', type: 'attachments', config: { multiple: false, preview: 'cover', fit: 'fill' } });
  weave.addField(deck, { name: 'Links', type: 'attachments', config: { preview: 'link' } });
  weave.addField(deck, { name: 'Blob', type: 'attachments', config: { multiple: false } });
  row = weave.createEntity(deck, { name: 'row' });
  files = {
    shot: weave.attachToField(row.id, 'Files', { name: 'shot.png', mime: 'image/png', bytes: PNG }),
    shot2: weave.attachToField(row.id, 'Files', { name: 'shot2.png', mime: 'image/png', bytes: PNG }),
    spec: weave.attachToField(row.id, 'Files', { name: 'spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }),
    site: weave.attachToField(row.id, 'Files', { name: 'site.html', mime: 'text/html', bytes: HTML }),
    page: weave.attachToField(row.id, 'Page', { name: 'page.html', mime: 'text/html', bytes: HTML }),
    hero: weave.attachToField(row.id, 'Hero', { name: 'hero.png', mime: 'image/png', bytes: PNG }),
    link: weave.attachToField(row.id, 'Links', { name: 'notes.txt', mime: 'text/plain', bytes: Buffer.from('n') }),
    blob: weave.attachToField(row.id, 'Blob', { name: 'bundle.zip', mime: 'application/zip', bytes: Buffer.from('PK') }),
    loose: weave.attachFile(row.id, { name: 'loose.txt', mime: 'text/plain', bytes: Buffer.from('loose') }),
  };
});

if (s) {
  const { base, browser } = s;
  const rowSel = (name) => `.attach-block[data-block="${name}"]`;

  async function open(theme = null) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    if (theme) await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(rowSel('Files') + ' .attach-sheet');
    return page;
  }

  test('a many-file field left unset is a sheet of its pictures (auto · medium · trim) with the rest as chips', async () => {
    const page = await open();
    try {
      const sheet = page.locator(rowSel('Files') + ' .attach-sheet');
      assert.deepEqual(await sheet.evaluate((n) => [...n.classList].sort()), ['attach-sheet', 'fit-trim', 'size-medium']);
      assert.deepEqual(await sheet.locator('.attach-cell').evaluateAll((ns) => ns.map((n) => n.title)), ['shot.png', 'shot2.png'], 'only the pictures are cells');
      const chips = await page.locator(rowSel('Files') + ' .attach-chips .attach-item a').evaluateAll((ns) => ns.map((n) => n.textContent));
      assert.deepEqual(chips, ['spec.pdf', 'site.html'], 'the pdf and the html stay chips under auto');
      const ar = await eventually(() => sheet.locator('.attach-cell').first().evaluate((n) => getComputedStyle(n).getPropertyValue('--ar').trim()), '2.000');
      assert.equal(ar, '2.000', 'trim reads the picture\'s own shape once it loads');
      assert.equal(await page.locator(rowSel('Links') + ' .attach-sheet').count(), 0, 'a link preview draws no sheet');
      assert.equal(await page.locator(rowSel('Links') + ' .attach-item').count(), 1);
    } finally { await page.close(); }
  });

  test('a single-file field left unset shows its HTML upload live in a sandboxed frame', async () => {
    const page = await open();
    try {
      const frame = page.locator(rowSel('Page') + ' .file-viewer.size-medium iframe.file-viewer-frame');
      await frame.waitFor();
      assert.equal(await frame.getAttribute('sandbox'), SANDBOX);
      assert.match(await frame.getAttribute('src'), new RegExp(`/api/files/${files.page.id}\\?view$`));
      const inner = page.frames().find((f) => f.url().endsWith(`/api/files/${files.page.id}?view`));
      assert.ok(inner, 'the frame loaded the ?view route');
      await inner.waitForFunction(() => document.title !== '');
      assert.equal(await inner.evaluate(() => document.getElementById('p').textContent), 'ran', 'the page\'s own script runs');
      assert.equal(await inner.evaluate(() => document.title), 'blocked', 'the page cannot reach the record page');
      assert.equal(await page.locator(rowSel('Page') + ' .attach-chips .attach-item').count(), 1, 'the chip row stays, for the name and the ×');
    } finally { await page.close(); }
  });

  test('a single-file field holding a kind with no viewer shows its chip alone, never the word null', async () => {
    const page = await open();
    try {
      const row = page.locator(rowSel('Blob'));
      assert.equal(await row.locator('.file-viewer').count(), 0, 'a zip has no viewer');
      assert.equal(await row.locator('.attach-chips .attach-item a').textContent(), 'bundle.zip');
      assert.doesNotMatch(await row.locator('.attach-box').textContent(), /null/, 'append(null) would print the word');
    } finally { await page.close(); }
  });
  test('a cover field puts its picture at the top of the record', async () => {
    const page = await open();
    try {
      const cover = page.locator('.entity-cover');
      assert.equal(await cover.count(), 1);
      assert.deepEqual(await cover.evaluate((n) => [...n.classList].sort()), ['entity-cover', 'fit-fill', 'size-medium']);
      assert.match(await cover.locator('img').getAttribute('src'), new RegExp(`/api/files/${files.hero.id}$`));
      assert.ok(await cover.evaluate((n) => n.compareDocumentPosition(document.querySelector('.fieldrow')) & Node.DOCUMENT_POSITION_FOLLOWING), 'the cover precedes the fields');
      assert.equal(await page.locator(rowSel('Hero') + ' .attach-item').count(), 1, 'the file stays a chip in its row');
    } finally { await page.close(); }
  });

  const panel = '#side .wv-file-panel';
  async function watchLeaks(page) {
    const leaks = [];
    page.on('download', (d) => leaks.push(`download ${d.suggestedFilename()}`));
    page.context().on('page', (p) => leaks.push(`tab ${p.url()}`));
    return leaks;
  }

  test('an HTML chip opens the file in the side panel beside the record, from the ?view route, with no download (Issue #1173)', async () => {
    const page = await open();
    try {
      const leaks = await watchLeaks(page);
      const hash = await page.evaluate(() => location.hash);
      const viewed = page.waitForRequest((r) => r.url().endsWith(`/api/files/${files.site.id}?view`));
      await page.click(rowSel('Files') + ' .attach-chips .attach-item a:text-is("site.html")');
      await page.waitForSelector(panel);
      await viewed;
      const frame = page.locator(`${panel} iframe`);
      assert.equal(await frame.getAttribute('sandbox'), SANDBOX);
      assert.match(await frame.getAttribute('src'), new RegExp(`/api/files/${files.site.id}\\?view$`));
      assert.equal(await page.locator(`${panel} .wv-file-name`).textContent(), 'site.html');
      const [main, side] = await Promise.all([page.locator('#main').boundingBox(), page.locator('#side').boundingBox()]);
      assert.ok(side.x >= main.x + main.width, 'the panel sits to the right of the record');
      assert.equal(await page.evaluate(() => location.hash), hash, 'the record stays where it was');
      await page.keyboard.press('Escape');
      await page.waitForSelector(panel, { state: 'detached' });
      assert.equal(await page.locator('#side').isHidden(), true, 'Esc closes the panel');
      assert.deepEqual(leaks, [], 'no download and no new tab');
    } finally { await page.close(); }
  });

  test('a PDF chip opens in the side panel; its full-screen button hands the file to the full-screen viewer, X closes the panel (Issue #1173)', async () => {
    const page = await open();
    try {
      await page.click(rowSel('Files') + ' .attach-chips .attach-item a:text-is("spec.pdf")');
      await page.waitForSelector(panel);
      assert.match(await page.locator(`${panel} iframe`).getAttribute('src'), new RegExp(`/api/files/${files.spec.id}$`));
      await page.click(`${panel} button[title="Full screen"]`);
      await page.waitForSelector('#fsv-back');
      assert.match(await page.locator('.fsv-frame').getAttribute('src'), new RegExp(`/api/files/${files.spec.id}$`));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#fsv-back', { state: 'detached' });
      assert.equal(await page.locator(panel).count(), 1, 'Esc in full screen closes the full-screen viewer only');
      await page.click(`${panel} button[title="Close (Esc)"]`);
      await page.waitForSelector(panel, { state: 'detached' });
    } finally { await page.close(); }
  });

  test('a sheet cell opens its picture in the side panel; next steps through the sheet and full screen keeps the arrows (Issue #1173)', async () => {
    const page = await open();
    try {
      await page.click(rowSel('Files') + ' .attach-cell');
      await page.waitForSelector(panel);
      assert.equal(await page.locator('#fsv-back').count(), 0, 'a cell no longer jumps to full screen');
      assert.match(await page.locator(`${panel} img`).getAttribute('src'), new RegExp(`/api/files/${files.shot.id}$`));
      await page.click(`${panel} button[title="Next"]`);
      await page.waitForFunction((id) => document.querySelector('#side .wv-file-panel img')?.getAttribute('src').endsWith(id), files.shot2.id);
      await page.click(`${panel} button[title="Full screen"]`);
      await page.waitForSelector('#fsv-back');
      assert.match(await page.locator('.fsv-title').textContent(), /shot2\.png · 2 \/ 2/);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => /1 \/ 2/.test(document.querySelector('.fsv-title')?.textContent ?? ''));
      assert.match(await page.locator('.fsv-frame').getAttribute('src'), new RegExp(`/api/files/${files.shot.id}$`));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#fsv-back', { state: 'detached' });
    } finally { await page.close(); }
  });

  test('the full-screen viewer bar has no Back control; X closes it (Issue #1174)', async () => {
    const page = await open();
    try {
      await page.click(rowSel('Files') + ' .attach-cell');
      await page.click(`${panel} button[title="Full screen"]`);
      await page.waitForSelector('#fsv-back');
      const titles = await page.locator('#fsv-back .fsv-bar [title]').evaluateAll((ns) => ns.map((n) => n.getAttribute('title')));
      assert.deepEqual(titles, ['Refresh', 'Previous (←)', 'Next (→)', 'Open in a browser tab', 'Report a problem', 'Close (Esc)']);
      await page.click('#fsv-back button[title="Close (Esc)"]');
      await page.waitForSelector('#fsv-back', { state: 'detached' });
    } finally { await page.close(); }
  });

  test('a chip on the loose Files card opens in the side panel too (Issue #1173)', async () => {
    const page = await open();
    try {
      await page.click('.entity-files-card .attach-item a:text-is("loose.txt")');
      await page.waitForSelector(panel);
      assert.match(await page.locator(`${panel} iframe`).getAttribute('src'), new RegExp(`/api/files/${files.loose.id}$`));
    } finally { await page.close(); }
  });

  test('a file with no viewer stays a plain link chip (Issue #1173)', async () => {
    const page = await open();
    try {
      const a = page.locator(rowSel('Blob') + ' .attach-item a');
      assert.match(await a.getAttribute('href'), new RegExp(`/api/files/${files.blob.id}$`));
      assert.equal(await page.locator(panel).count(), 0);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`the side file panel draws on the panel surface (${theme}) (Issue #1173)`, async () => {
      const page = await open(theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        await page.click(rowSel('Files') + ' .attach-chips .attach-item a:text-is("site.html")');
        await page.waitForSelector(panel);
        const [bg, surface, head] = await page.evaluate(() => {
          const probe = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'background: var(--tblr-bg-surface)' }));
          const out = [getComputedStyle(document.querySelector('#side .wv-file-panel')).backgroundColor, getComputedStyle(probe).backgroundColor, getComputedStyle(document.querySelector('#side .wv-file-name')).color];
          probe.remove();
          return out;
        });
        assert.equal(bg, surface, 'the panel takes the surface token');
        assert.notEqual(head, bg, 'the name reads against the panel');
      } finally { await page.close(); }
    });
  }
}
