import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'weave-sec-blob-unlink-'));
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
