import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave, FILE_STORAGE_CAP, FRAME_HEIGHT_SCRIPT, frameStorageScript, viewHtml } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const PAGE = Buffer.from('<!doctype html><p>deck</p>');

function fresh(path) {
  const w = new Weave(path ? { path } : undefined);
  if (!Object.values(w.state.tables).some((t) => t.name === 'Issue')) {
    w.createSpace({ name: 'Dev' });
    w.createTable({ space: 'Dev', name: 'Issue' });
  }
  return w;
}

test('an HTML file keeps page storage beside its bytes, across a reopen (Issue #1176)', () => {
  const dir = tempDir('weave-file-storage-');
  const path = join(dir, 'ws.db');
  const w = fresh(path);
  const e = w.createEntity('Issue', { name: 'Deck' });
  const file = w.attachFile(e.id, { name: 'deck.html', mime: 'text/html', bytes: PAGE });
  assert.deepEqual(w.readFileStorage(file.id), { file: file.id, items: {}, bytes: 0, updatedAt: null }, 'a new file keeps nothing');
  const saved = w.writeFileStorage(file.id, { 'deck:edits': '{"title":"Q4"}', n: '2' });
  assert.equal(saved.bytes, Buffer.byteLength(JSON.stringify({ 'deck:edits': '{"title":"Q4"}', n: '2' })));
  const again = fresh(path);
  assert.deepEqual(again.readFileStorage(file.id).items, { 'deck:edits': '{"title":"Q4"}', n: '2' }, 'the storage survives a reopen');
  assert.deepEqual(again.readFile(file.id).bytes, PAGE, 'the file bytes are unchanged');
  again.deleteFile(e.id, file.id);
  assert.throws(() => again.readFileStorage(file.id), /not found/);
  assert.equal(fresh(path).store.getFileStorage(file.id), null, 'deleting the file drops its storage');
});

test('page storage refuses anything but string values, a file that is not HTML, and a store over the cap (Issue #1176)', () => {
  const w = fresh();
  const e = w.createEntity('Issue', { name: 'Deck' });
  const page = w.attachFile(e.id, { name: 'deck.html', mime: 'text/html', bytes: PAGE });
  const pdf = w.attachFile(e.id, { name: 'a.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
  assert.throws(() => w.writeFileStorage(pdf.id, { a: '1' }), /only an HTML file/);
  assert.throws(() => w.writeFileStorage(page.id, ['a']), /object of string keys/);
  assert.throws(() => w.writeFileStorage(page.id, { a: 1 }), /'a' holds a number/);
  assert.throws(() => w.writeFileStorage('no-such-file', {}), /not found/);
  w.writeFileStorage(page.id, { keep: 'me' });
  const big = 'x'.repeat(FILE_STORAGE_CAP);
  assert.throws(() => w.writeFileStorage(page.id, { big }), (err) => err.code === 'too-large' && /at most 5 MB, so this change was not saved/.test(err.message));
  assert.deepEqual(w.readFileStorage(page.id).items, { keep: 'me' }, 'a refused write leaves the last saved storage');
});

test('the storage script seeds the snapshot as data that cannot close its own script tag (Issue #1176)', () => {
  const script = frameStorageScript({ a: '</script><img src=x onerror=alert(1)>', b: ' ' });
  assert.equal(script.match(/<\/script>/gi).length, 1, 'one closing tag, its own');
  assert.match(script, /\\u003c\/script>/);
  assert.match(script, /Object\.defineProperty\(window, name/, 'it replaces localStorage and sessionStorage');
  assert.match(script, /parent\.postMessage\(\{ weave: 'frame-storage'/, 'writes go to the parent');
  assert.doesNotMatch(script, /fetch|XMLHttpRequest|cookie|indexedDB/, 'it reaches nothing but the parent');
  new Function(script.replace(/^<script>|<\/script>$/g, ''));
});

test('GET /api/files/:id?view serves the saved storage with the page; PUT and GET /storage write and read it (Issue #1176)', async () => {
  const w = fresh();
  const e = w.createEntity('Issue', { name: 'Deck' });
  const file = w.attachFile(e.id, { name: 'deck.html', mime: 'text/html', bytes: PAGE });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (items) => fetch(`${base}/api/files/${file.id}/storage`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  try {
    const first = await fetch(`${base}/api/files/${file.id}?view`);
    assert.equal(first.headers.get('cache-control'), 'no-store', 'a stale snapshot is never served from a cache');
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), viewHtml(PAGE, frameStorageScript({}) + FRAME_HEIGHT_SCRIPT));
    assert.equal((await put({ n: '3' })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/files/${file.id}/storage`)).json().then((r) => r.items), { n: '3' });
    const page = await (await fetch(`${base}/api/files/${file.id}?view`)).text();
    assert.ok(page.includes(frameStorageScript({ n: '3' })), 'the next view starts from the saved snapshot');
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/files/${file.id}`)).arrayBuffer()), PAGE, 'the bare route still answers the file as stored');
    const over = await put({ big: 'x'.repeat(FILE_STORAGE_CAP) });
    assert.equal(over.status, 413);
    assert.match((await over.json()).error, /at most 5 MB/);
  } finally { server.close(); }
});
