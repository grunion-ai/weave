import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';
import { startServer } from '../../src/server.js';

const ROOT = tempDir('weave-sec-blob-unlink-');
process.env.WEAVE_KEYSTORE = join(ROOT, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let n = 0;
function fresh() {
  const dir = join(ROOT, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  const w = new Weave({ path: join(dir, 'w.db'), keystorePath: process.env.WEAVE_KEYSTORE });
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  const e = w.createEntity('T', { Name: 'row' });
  const blob = (id) => join(dir, 'files', id);
  return { w, e, blob };
}

test('deleteFile removes the blob from files/ with the record (Issue #540)', () => {
  const { w, e, blob } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes') });
  assert.ok(existsSync(blob(f.id)), 'the upload lands on disk');
  w.deleteFile(e.id, f.id);
  assert.equal(existsSync(blob(f.id)), false, 'the blob is gone');
  assert.deepEqual(w.readEntity(e.id).files, []);
  assert.throws(() => w.readFile(f.id), /not found/);
});

test('undoing an attachment removes its blob (Issue #540)', () => {
  const { w, e, blob } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes') });
  w.undo();
  assert.equal(existsSync(blob(f.id)), false);
});

test('a trashed row keeps its blobs for a restore; a purge removes them (Issue #540)', () => {
  const { w, e, blob } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes') });
  w.deleteEntity(e.id);
  assert.ok(existsSync(blob(f.id)), 'the trash can still give the file back');
  w.restoreEntity(e.id);
  assert.deepEqual(w.readFile(f.id).bytes, Buffer.from('bytes'));
  w.deleteEntity(e.id, { hard: true });
  assert.equal(existsSync(blob(f.id)), false, 'the purge takes the blob');
});

test('a hard-deleted table takes its rows\' blobs with it (Issue #540)', () => {
  const { w, e, blob } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes') });
  w.deleteTable('T', { hard: true });
  assert.equal(existsSync(blob(f.id)), false);
});

test('deleteWorkspaceLogo and a replacing setWorkspaceLogo remove the old logo blob (Issue #540)', () => {
  const { w, blob } = fresh();
  const first = w.setWorkspaceLogo({ name: 'logo.png', bytes: PNG });
  assert.ok(existsSync(blob(first.id)));
  const second = w.setWorkspaceLogo({ name: 'logo2.png', bytes: Buffer.concat([PNG, Buffer.from('v2')]) });
  assert.equal(existsSync(blob(first.id)), false, 'the replaced logo is gone');
  assert.ok(existsSync(blob(second.id)));
  w.deleteWorkspaceLogo();
  assert.equal(existsSync(blob(second.id)), false);
});

test('a blob another row still names is kept when one record goes (Issue #540)', () => {
  const { w, e, blob } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes') });
  const dump = w.exportJSON();
  const twin = structuredClone(dump.entities[e.id]);
  twin.id = '00000000-0000-4000-8000-000000000002';
  twin.publicId = 2;
  dump.entities[twin.id] = twin;
  w.importJSON(dump);
  w.deleteFile(e.id, f.id);
  assert.ok(existsSync(blob(f.id)), 'the twin row still reads the file');
  assert.deepEqual(w.readFile(f.id).bytes, Buffer.from('bytes'));
  w.deleteFile(twin.id, f.id);
  assert.equal(existsSync(blob(f.id)), false, 'the last reference takes the blob');
});
function pair() {
  const dir = join(ROOT, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  const open = (name) => new Weave({ path: join(dir, `${name}.db`), keystorePath: process.env.WEAVE_KEYSTORE });
  const a = open('a');
  a.createSpace({ name: 'S' });
  a.createTable({ space: 'S', name: 'T' });
  const e = a.createEntity('T', { Name: 'row' });
  const f = a.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('bytes of a') });
  const b = open('b');
  b.importJSON(a.exportJSON());
  return { a, b, e, f, open, blob: (id) => join(dir, 'files', id) };
}

test('a delete in one workspace keeps a blob another workspace in the data dir still names (Issue #1359)', () => {
  const { a, b, e, f, blob } = pair();
  assert.deepEqual(b.readFile(f.id).bytes, Buffer.from('bytes of a'), 'the import names the same file id');
  b.deleteFile(e.id, f.id);
  assert.ok(existsSync(blob(f.id)), 'workspace a still names the blob');
  assert.deepEqual(a.readFile(f.id).bytes, Buffer.from('bytes of a'));
  a.deleteFile(e.id, f.id);
  assert.equal(existsSync(blob(f.id)), false, 'the last reference in the data dir takes the blob');
});

test('a purged row and a hard-deleted table keep blobs a sibling workspace names (Issue #1359)', () => {
  const { a, b, e, f, blob } = pair();
  b.deleteEntity(e.id, { hard: true });
  b.deleteTable('T', { hard: true });
  assert.deepEqual(a.readFile(f.id).bytes, Buffer.from('bytes of a'));
  a.deleteEntity(e.id, { hard: true });
  assert.equal(existsSync(blob(f.id)), false);
});

test('removing a logo keeps the blob a sibling workspace still uses as its logo (Issue #1359)', () => {
  const { a, b, blob } = pair();
  const logo = a.setWorkspaceLogo({ name: 'logo.png', bytes: PNG });
  b.importJSON(a.exportJSON());
  b.deleteWorkspaceLogo();
  assert.ok(existsSync(blob(logo.id)), 'workspace a still shows the logo');
  assert.ok(a.getWorkspaceLogo());
  a.deleteWorkspaceLogo();
  assert.equal(existsSync(blob(logo.id)), false);
});

test('a file id from a sibling workspace answers 404 on GET and never serves the shared blob (Issue #1434)', async () => {
  const { a, open, f, blob } = pair();
  const c = open('c');
  assert.ok(existsSync(blob(f.id)), 'the blob sits in the shared files/ folder');
  assert.throws(() => c.readFile(f.id), /not found/);
  const { server, port } = await startServer(c, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/files/${f.id}`);
    assert.equal(res.status, 404);
    assert.doesNotMatch(await res.text(), /bytes of a/);
    const own = await startServer(a, { port: 0 });
    try {
      const ok = await fetch(`http://127.0.0.1:${own.port}/api/files/${f.id}`);
      assert.equal(ok.status, 200);
    } finally { own.server.close(); }
  } finally { server.close(); }
});
test('an observer PUT to an HTML file storage answers 403 and leaves the storage untouched (Issue #1434)', async () => {
  const { a, e } = pair();
  const html = a.attachFile(e.id, { name: 'page.html', mime: 'text/html', bytes: Buffer.from('<p>hi</p>') });
  const token = a.createAccount({ name: 'read', role: 'observer' }).token;
  a.setRequireAuth(true);
  const before = a.readFileStorage(html.id);
  const { server, port } = await startServer(a, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/files/${html.id}/storage`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: { k: 'forbidden' } }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(a.readFileStorage(html.id), before);
  } finally { server.close(); }
});
