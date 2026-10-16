import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withServer } from './lib/fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ICO = new Uint8Array(readFileSync(join(ROOT, 'public/brand/favicon.ico')));

test('a browser that asks for /favicon.ico gets the weave mark (Issue #848)', async () => {
  await withServer(async (get) => {
    const res = await get('/favicon.ico');
    assert.equal(res.status, 200, 'a browser with no usable icon link falls back to the site root');
    assert.equal(res.headers.get('content-type'), 'image/x-icon');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), ICO, 'the root icon is the one built icon, not a second copy');
  });
});

test('the brand icon is served as an icon, not as a download (Issue #848)', async () => {
  await withServer(async (get) => {
    const res = await get('/brand/favicon.ico');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/x-icon',
      'application/octet-stream is a file to save, not an icon to draw');
  });
});

test('every served page names an ICO beside the SVG icon (Issue #848)', () => {
  for (const page of ['public/index.html', 'public/start.html', 'public/billing.html', 'public/404.html']) {
    const html = read(page);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/brand\/weave-favicon\.svg">/, `${page} keeps the SVG icon`);
    assert.match(html, /<link rel="alternate icon" href="\/brand\/favicon\.ico">/, `${page} needs the ICO fallback Safari can draw`);
  }
});
