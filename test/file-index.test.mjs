import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

const dir = tempDir('weave-file-index-');
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const bytes = (s) => Buffer.from(s);

function stand(rows = 2) {
  const w = new Weave();
  w.createSpace({ name: 'Open' });
  const t = w.createTable({ space: 'Open', name: 'Item' });
  const ids = Array.from({ length: rows }, (_, i) => w.createEntity(t.id, { name: `R${i}` }).id);
  return { w, t, ids };
}

test('a file read follows the file to the row that holds it now: attach, delete and reattach elsewhere (Issue #1435)', () => {
  const { w, ids: [a, b] } = stand();
  const first = w.attachFile(a, { name: 'one.txt', mime: 'text/plain', bytes: bytes('one') });
  assert.equal(w.readFileMeta(first.id).name, 'one.txt');
  assert.equal(w.readFile(first.id).bytes.toString(), 'one');
  w.deleteFile(a, first.id);
  assert.throws(() => w.readFileMeta(first.id), /not found/, 'a deleted file is not found after it was read once');
  assert.throws(() => w.readFile(first.id), /not found/);
  const second = w.attachFile(b, { name: 'two.txt', mime: 'text/plain', bytes: bytes('two') });
  assert.equal(w.readFileMeta(second.id).name, 'two.txt', 'a file attached after the first read is found');
  assert.equal(w.readFile(second.id).bytes.toString(), 'two');
  w.undo();
  assert.throws(() => w.readFileMeta(second.id), /not found/, 'undoing the attach takes the file away');
});

test('a file is still read after an import replaces every row object (Issue #1435)', () => {
  const { w, ids: [a] } = stand();
  const f = w.attachFile(a, { name: 'k.txt', mime: 'text/plain', bytes: bytes('kept') });
  assert.equal(w.readFile(f.id).bytes.toString(), 'kept');
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  assert.equal(copy.readFile(f.id).bytes.toString(), 'kept');
  w.importJSON(w.exportJSON());
  assert.equal(w.readFile(f.id).bytes.toString(), 'kept', 'the same workspace reads the file after its rows were replaced');
});

test('200 file reads over 5,000 rows stay inside a small budget instead of scanning every row each time (Issue #1435)', () => {
  const { w, ids } = stand(5000);
  const files = ids.map((id, i) => w.attachFile(id, { name: `f${i}.txt`, mime: 'text/plain', bytes: bytes('x') }).id);
  w.readFileMeta(files[0]);
  const picks = Array.from({ length: 200 }, (_, i) => files[(i * 37) % files.length]);
  const t0 = performance.now();
  for (const id of picks) w.readFileMeta(id);
  const ms = performance.now() - t0;
  assert.ok(ms < 20, `200 reads took ${ms.toFixed(1)} ms over 5,000 rows`);
});

test('a reader without access to a private space still gets not-found for its file, before and after a visible read (Issue #1435)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Open' });
  w.createSpace({ name: 'Sales' });
  const item = w.createTable({ space: 'Open', name: 'Item' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  const shown = w.attachFile(w.createEntity(item.id, { name: 'E' }).id, { name: 'a.txt', mime: 'text/plain', bytes: bytes('open') });
  const hidden = w.attachFile(w.createEntity(deal.id, { name: 'S' }).id, { name: 's.txt', mime: 'text/plain', bytes: bytes('secret') });
  const arc = w.createAccount({ name: 'arc', role: 'architect' }).token;
  const olive = w.createAccount({ name: 'olive', role: 'editor' }).token;
  w.updateSpace('Sales', { access: 'private' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const get = (id, token) => fetch(`http://127.0.0.1:${server.address().port}/api/files/${id}`, { headers: { authorization: `Bearer ${token}` } });
  try {
    assert.equal((await get(hidden.id, olive)).status, 404);
    assert.equal((await get(shown.id, olive)).status, 200);
    assert.equal((await get(hidden.id, arc)).status, 200);
    assert.equal((await get(hidden.id, olive)).status, 404, 'the index never lets a hidden row through');
  } finally { server.close(); }
});
