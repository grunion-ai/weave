import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const COUNTER = Buffer.from('<!doctype html><body><p id="n"></p><script>const n = Number(localStorage.getItem("count") || 0) + 1; localStorage.setItem("count", String(n)); sessionStorage.setItem("seen", "1"); document.getElementById("n").textContent = n + ":" + localStorage.length + ":" + Object.keys(localStorage).join(",");</script></body>');
const HIJACK = Buffer.from('<!doctype html><body>hijack<script>parent.postMessage({ weave: "frame-storage", items: { count: "999", stolen: "1" } }, "*");</script></body>');
const HOG = Buffer.from('<!doctype html><body>hog<script>localStorage.setItem("big", "x".repeat(5.5 * 1024 * 1024));</script></body>');

let row, files, weaveRef;
const s = await launch('html page storage bridge', (weave) => {
  weaveRef = weave;
  weave.createSpace({ name: 'Site' });
  const pages = weave.createTable({ space: 'Site', name: 'Page' });
  weave.addField(pages, { name: 'Pages', type: 'attachments' });
  weave.addField(pages, { name: 'Hog', type: 'attachments', config: { preview: 'link' } });
  row = weave.createEntity(pages, { name: 'row' });
  files = {
    counter: weave.attachToField(row.id, 'Pages', { name: 'counter.html', mime: 'text/html', bytes: COUNTER }),
    hijack: weave.attachToField(row.id, 'Pages', { name: 'hijack.html', mime: 'text/html', bytes: HIJACK }),
    hog: weave.attachToField(row.id, 'Hog', { name: 'hog.html', mime: 'text/html', bytes: HOG }),
  };
});

if (s) {
  const { base, browser } = s;
  const counterText = (p) => p.frames().find((f) => f.url().endsWith(`/api/files/${files.counter.id}?view`))?.evaluate(() => document.getElementById('n').textContent) ?? null;
  async function open() {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const saved = p.waitForResponse((r) => r.url().endsWith(`/api/files/${files.counter.id}/storage`) && r.request().method() === 'PUT');
    await p.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    return { p, saved };
  }

  test('a page that writes localStorage keeps its value across a reload, and the file bytes stay as uploaded (Issue #1176)', async () => {
    const { p, saved } = await open();
    try {
      assert.equal(await eventually(() => counterText(p), '1:1:count'), '1:1:count', 'the page reads and writes a working localStorage');
      assert.equal((await saved).status(), 200, 'the parent saved the change');
      assert.deepEqual(weaveRef.readFileStorage(files.counter.id).items, { count: '1' }, 'sessionStorage is not saved');
      const again = p.waitForResponse((r) => r.url().endsWith(`/api/files/${files.counter.id}/storage`) && r.request().method() === 'PUT');
      await p.reload({ waitUntil: 'networkidle' });
      assert.equal(await eventually(() => counterText(p), '2:1:count'), '2:1:count', 'the reload starts from the saved snapshot');
      await again;
      assert.deepEqual(weaveRef.readFileStorage(files.counter.id).items, { count: '2' });
      assert.deepEqual(weaveRef.readFile(files.counter.id).bytes, COUNTER, 'the file is unchanged');
      const sandbox = await p.locator(`iframe[data-file-id="${files.counter.id}"]`).first().getAttribute('sandbox');
      assert.doesNotMatch(sandbox, /allow-same-origin/, 'the frame still has no route to the API');
    } finally { await p.close(); }
  });

  test('a frame can write only its own file\'s storage; a window that is no file frame writes nothing (Issue #1176)', async () => {
    const { p, saved } = await open();
    try {
      await saved;
      await eventually(() => weaveRef.readFileStorage(files.hijack.id).items.stolen ?? null, '1');
      await p.evaluate((id) => new Promise((resolve) => {
        addEventListener('message', function seen(e) { if (e.data?.items?.forged) { removeEventListener('message', seen); setTimeout(resolve, 0); } });
        const stranger = Object.assign(document.createElement('iframe'), { srcdoc: '<script>parent.postMessage({ weave: "frame-storage", items: { forged: "1" } }, "*")</script>' });
        stranger.setAttribute('sandbox', 'allow-scripts');
        stranger.dataset.note = id;
        document.body.append(stranger);
      }), files.counter.id);
      await p.evaluate(() => new Promise((r) => setTimeout(r, 0)));
      const counter = weaveRef.readFileStorage(files.counter.id).items;
      assert.equal(counter.stolen, undefined, 'another file\'s frame cannot write here');
      assert.equal(counter.forged, undefined, 'a frame that shows no file cannot write here');
      assert.notEqual(counter.count, '999');
    } finally { await p.close(); }
  });

  test('a page storage over 5 MB is refused with a message and nothing is saved (Issue #1176)', async () => {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await p.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      const refused = p.waitForResponse((r) => r.url().endsWith(`/api/files/${files.hog.id}/storage`) && r.request().method() === 'PUT');
      await p.click('.attach-block[data-block="Hog"] .attach-item a');
      assert.equal((await refused).status(), 413);
      await p.waitForSelector('#wv-toasts :text("at most 5 MB")');
      assert.deepEqual(weaveRef.readFileStorage(files.hog.id).items, {});
    } finally { await p.close(); }
  });
}
