import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const page = (px, word) => Buffer.from(`<!doctype html><html><body style="margin:0"><div style="height:${px}px">${word}</div></body></html>`);
let row, files;
const s = await launch('html files inline at their own height', (weave) => {
  weave.createSpace({ name: 'Site' });
  const pages = weave.createTable({ space: 'Site', name: 'Page' });
  weave.addField(pages, { name: 'Pages', type: 'attachments' });
  weave.addField(pages, { name: 'Links', type: 'attachments', config: { preview: 'link' } });
  row = weave.createEntity(pages, { name: 'row' });
  files = {
    tall: weave.attachToField(row.id, 'Pages', { name: 'tall.html', mime: 'text/html', bytes: page(3000, 'tall') }),
    short: weave.attachToField(row.id, 'Pages', { name: 'short.html', mime: 'text/html', bytes: page(120, 'short') }),
    screen: weave.attachToField(row.id, 'Pages', { name: 'screen.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><body style="margin:8px"><div style="height:100vh">screen</div></body>') }),
    linked: weave.attachToField(row.id, 'Links', { name: 'linked.html', mime: 'text/html', bytes: page(400, 'linked') }),
    loose: weave.attachFile(row.id, { name: 'loose.html', mime: 'text/html', bytes: page(240, 'loose') }),
  };
});

if (s) {
  const { base, browser } = s;
  const frameOf = (file) => `iframe[data-file-id="${file.id}"]`;
  const height = (p, file) => p.locator(`#main ${frameOf(file)}`).evaluate((n) => Math.round(n.getBoundingClientRect().height));

  async function open(theme = null) {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    if (theme) await p.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await p.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await p.waitForSelector(`#main ${frameOf(files.tall)}`);
    return p;
  }

  test('every HTML file in a many-file field renders inline, one frame each, at its own content height (Issue #1175)', async () => {
    const p = await open();
    try {
      const block = p.locator('.attach-block[data-block="Pages"]');
      assert.equal(await block.locator('.file-viewer.fit-content iframe').count(), 3, 'one frame per HTML file');
      assert.equal(await eventually(() => height(p, files.tall), 3000), 3000, 'the 3,000 px page is 3,000 px tall');
      assert.equal(await eventually(() => height(p, files.short), 120), 120, 'the short page shrinks the frame');
      const inner = p.frames().find((f) => f.url().endsWith(`/api/files/${files.tall.id}?view`));
      assert.equal(await inner.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'no scrollbar inside the frame');
      assert.equal(await inner.evaluate(() => document.querySelector('div').textContent), 'tall');
      assert.match(await block.locator(`iframe[data-file-id="${files.tall.id}"]`).getAttribute('sandbox'), /^allow-scripts/);
      assert.doesNotMatch(await block.locator(`iframe[data-file-id="${files.tall.id}"]`).getAttribute('sandbox'), /allow-same-origin/);
    } finally { await p.close(); }
  });

  test('a link-preview field keeps its HTML file a chip; a loose HTML file renders inline too (Issue #1175)', async () => {
    const p = await open();
    try {
      assert.equal(await p.locator(`.attach-block[data-block="Links"] iframe`).count(), 0, 'link means a chip only');
      assert.equal(await eventually(() => height(p, files.loose), 240), 240, 'the loose Files card shows its HTML at its height');
    } finally { await p.close(); }
  });

  test('a height message from any other window is ignored (Issue #1175)', async () => {
    const p = await open();
    try {
      await eventually(() => height(p, files.tall), 3000);
      await eventually(() => height(p, files.short), 120);
      await p.evaluate(() => new Promise((resolve) => {
        addEventListener('message', function seen(e) { if (e.data?.height === 77) { removeEventListener('message', seen); requestAnimationFrame(() => resolve()); } });
        const stranger = Object.assign(document.createElement('iframe'), { srcdoc: '<script>parent.postMessage({ weave: "frame-height", height: 77 }, "*")</script>' });
        stranger.setAttribute('sandbox', 'allow-scripts');
        stranger.dataset.fileId = 'stranger';
        document.body.append(stranger);
        postMessage({ weave: 'frame-height', height: 5 }, '*');
      }));
      assert.equal(await height(p, files.tall), 3000, 'the tall frame keeps its own height');
      assert.equal(await height(p, files.short), 120, 'and so does the short one');
    } finally { await p.close(); }
  });

  test('a page laid out on the viewport height stops instead of growing without end (Issue #1175)', async () => {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await p.addInitScript(() => {
      window.__heights = {};
      addEventListener('message', (e) => {
        if (e.data?.weave !== 'frame-height') return;
        const f = [...document.querySelectorAll('iframe[data-file-id]')].find((x) => x.contentWindow === e.source);
        if (f) (window.__heights[f.dataset.fileId] ??= []).push(e.data.height);
      });
    });
    try {
      await p.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await eventually(() => height(p, files.tall), 3000);
      await eventually(() => p.evaluate((id) => (window.__heights[id] ?? []).length >= 1, files.screen.id), true);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const sent = await p.evaluate((id) => window.__heights[id], files.screen.id);
      assert.ok(sent.length <= 2, `it stops reporting: ${sent.join(', ')}`);
      assert.equal(await height(p, files.screen), sent.at(-1));
      assert.ok(sent.at(-1) < 900, 'the frame never runs away');
    } finally { await p.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`the inline HTML viewer bar draws on the panel surface (${theme}) (Issue #1175)`, async () => {
      const p = await open(theme);
      try {
        assert.equal(await p.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        const [bar, surface] = await p.evaluate(() => {
          const probe = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'background: var(--tblr-bg-surface)' }));
          const out = [getComputedStyle(document.querySelector('.file-viewer.fit-content .file-viewer-bar')).backgroundColor, getComputedStyle(probe).backgroundColor];
          probe.remove();
          return out;
        });
        assert.equal(bar, surface);
      } finally { await p.close(); }
    });
  }
}
