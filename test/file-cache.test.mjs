import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

const dir = tempDir('weave-file-cache-');
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const SMALL = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000ff', 'hex');
const HTML = Buffer.from('<!doctype html><p>page</p>');
const IMMUTABLE = 'private, max-age=31536000, immutable';

async function stand() {
  const w = new Weave();
  w.createSpace({ name: 'Open' });
  w.createSpace({ name: 'Sales' });
  const item = w.createTable({ space: 'Open', name: 'Item' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  const e = w.createEntity(item.id, { name: 'E' });
  const secret = w.createEntity(deal.id, { name: 'Secret' });
  const png = w.attachFile(e.id, { name: 'a.png', mime: 'image/png', bytes: PNG, preview: { bytes: SMALL } });
  const page = w.attachFile(e.id, { name: 'p.html', mime: 'text/html', bytes: HTML });
  const hidden = w.attachFile(secret.id, { name: 's.png', mime: 'image/png', bytes: PNG });
  const tokens = {
    arc: w.createAccount({ name: 'arc', role: 'architect' }).token,
    olive: w.createAccount({ name: 'olive', role: 'editor' }).token,
  };
  w.updateSpace('Sales', { access: 'private' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, { token = tokens.arc, etag } = {}) => fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(etag ? { 'if-none-match': etag } : {}) },
  });
  return { w, get, png, page, hidden, tokens, stop: () => server.close() };
}

test('a file GET is cached for a year under a strong ETag named by the file id', async () => {
  const s = await stand();
  try {
    const full = await s.get(`/api/files/${s.png.id}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('cache-control'), IMMUTABLE);
    assert.equal(full.headers.get('etag'), `"${s.png.id}"`);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), PNG);
    const small = await s.get(`/api/files/${s.png.id}?preview`);
    assert.equal(small.status, 200);
    assert.equal(small.headers.get('cache-control'), IMMUTABLE);
    assert.equal(small.headers.get('etag'), `"${s.png.id}-preview"`);
    assert.deepEqual(Buffer.from(await small.arrayBuffer()), SMALL);
  } finally { s.stop(); }
});

test('a matching If-None-Match answers 304 without reading the file', async () => {
  const s = await stand();
  try {
    let reads = 0;
    const readFile = s.w.readFile.bind(s.w);
    s.w.readFile = (...args) => { reads += 1; return readFile(...args); };
    for (const [path, etag] of [[`/api/files/${s.png.id}`, `"${s.png.id}"`], [`/api/files/${s.png.id}?preview`, `"${s.png.id}-preview"`]]) {
      const res = await s.get(path, { etag });
      assert.equal(res.status, 304, path);
      assert.equal(res.headers.get('etag'), etag);
      assert.equal(res.headers.get('cache-control'), IMMUTABLE);
    }
    assert.equal(reads, 0, 'a revalidation reads no bytes');
    assert.equal((await s.get(`/api/files/${s.png.id}`, { etag: `"${s.png.id}-preview"` })).status, 200, 'the preview tag does not revalidate the full file');
    assert.equal(reads, 1);
  } finally { s.stop(); }
});

test('a file on a row the caller cannot see answers 404, never 304', async () => {
  const s = await stand();
  try {
    const etag = `"${s.hidden.id}"`;
    assert.equal((await s.get(`/api/files/${s.hidden.id}`, { token: s.tokens.olive, etag })).status, 404);
    assert.equal((await s.get(`/api/files/${s.hidden.id}`, { token: s.tokens.olive })).status, 404);
    assert.equal((await s.get(`/api/files/${s.hidden.id}`, { etag })).status, 304, 'an architect sees the private space');
  } finally { s.stop(); }
});

test('an HTML ?view page stays no-store with no ETag', async () => {
  const s = await stand();
  try {
    const res = await s.get(`/api/files/${s.page.id}?view`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('etag'), null);
    assert.match(await res.text(), /<p>page<\/p>/);
  } finally { s.stop(); }
});
