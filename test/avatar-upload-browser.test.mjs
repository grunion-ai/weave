import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
  Buffer.from('0000000d4944415478da63f8cfc0f01f0005000201a5f3a80000000049454e44ae426082', 'hex'),
  Buffer.alloc(40 * 1024),
]);

const s = await launch('the avatar picker streams its file', (w) => {
  w.createSpace({ name: 'CRM' });
  const table = w.createTable({ space: 'CRM', name: 'Contact' });
  w.addField('Contact', { name: 'Face', type: 'avatar' });
  const row = w.createEntity(table.id, { name: 'Ada Lovelace' });
  return { table, row };
});

if (s) {
  const { base, browser, weave, row } = s;

  test('the avatar picker sends the file as raw bytes under an upload grant, never a base64 body', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const seen = [];
    page.on('request', (r) => {
      if (!r.url().includes('/api/')) return;
      seen.push({ method: r.method(), url: r.url(), type: r.headers()['content-type'] ?? '', body: r.postData() ?? '' });
    });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      const input = page.locator('.av-control input[type=file]').first();
      await input.waitFor({ state: 'attached' });
      await input.setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForResponse((res) => res.request().method() === 'PUT' && res.url().endsWith('/api/uploads'), { timeout: 20_000 });
      await page.waitForFunction(() => !document.querySelector('.av-control .upload-tile'), null, { timeout: 20_000 }).catch(() => {});

      const grant = seen.filter((r) => r.method === 'POST' && r.url.endsWith('/api/uploads'));
      assert.equal(grant.length, 1, 'the picker prepares exactly one upload grant');
      const asked = JSON.parse(grant[0].body || '{}');
      assert.equal(asked.size, PNG.length, 'the grant declares the file size');
      assert.equal(asked.mime, 'image/png');
      assert.equal(asked.contentBase64, undefined, 'a grant carries no file content');
      assert.equal(asked.preview, undefined, 'an avatar asks for no preview, so nothing extra is encoded or stored');

      const put = seen.filter((r) => r.method === 'PUT' && r.url.endsWith('/api/uploads'));
      assert.equal(put.length, 1, 'the bytes go up once, as a raw PUT');
      assert.match(put[0].type, /^application\/octet-stream/, 'the body is raw bytes, not JSON');

      const base64Bodies = seen.filter((r) => r.body.includes('"bytes"'));
      assert.deepEqual(base64Bodies.map((r) => `${r.method} ${new URL(r.url).pathname}`), [], 'no request carries the file base64-encoded');

      const file = weave.getEntity(row.id).files.at(-1);
      assert.equal(file.size, PNG.length, 'the whole file landed');
      assert.equal(file.mime, 'image/png', 'the type is sniffed from the streamed bytes');
      assert.equal(file.preview, undefined, 'and no preview blob was stored beside it');
    } finally { await page.close(); }
  });

  test('the face on the page is the file that was just streamed', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      const img = page.locator('.av-control img').first();
      await img.waitFor({ timeout: 20_000 });
      const src = await img.getAttribute('src');
      assert.ok(src.includes(weave.getEntity(row.id).files.at(-1).id), 'the picker shows the stored file');
    } finally { await page.close(); }
  });
}
