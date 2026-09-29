/* Issue #479: a file or logo id arriving in an imported workspace was used
   as a path component, so `../` in it reached outside the workspace's
   files/ directory, to write on import and to read on export, file read and
   logo read. Ids now have to look like the uuids the engine mints, and an
   import carrying any other id is refused before it changes anything. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'weave-sec-blob-'));
process.env.WEAVE_KEYSTORE = join(ROOT, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

let n = 0;
function fresh() {
  const dir = join(ROOT, `case-${++n}`, 'data');
  mkdirSync(dir, { recursive: true });
  const w = new Weave({ path: join(dir, 'w.db'), keystorePath: process.env.WEAVE_KEYSTORE });
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  const e = w.createEntity('T', { Name: 'row' });
  return { w, dir, e };
}

const BAD = ['../../escaped.txt', '../outside', 'a/b', '..', 'not-a-uuid', '__proto__'];

test('an import whose fileBlobs key leaves files/ is refused and writes nothing', () => {
  for (const id of BAD) {
    const { w, dir } = fresh();
    const before = JSON.stringify(w.exportJSON());
    const dump = w.exportJSON();
    dump.fileBlobs = { [id]: Buffer.from('pwned').toString('base64') };
    assert.throws(() => w.importJSON(dump), /file id/i, id);
    assert.equal(existsSync(join(dir, '..', 'escaped.txt')), false, id);
    assert.equal(existsSync(join(dir, 'outside')), false, id);
    assert.equal(JSON.stringify(w.exportJSON()), before, `workspace unchanged after refusing ${id}`);
  }
});

test('an import whose entity file id leaves files/ is refused', () => {
  const { w, dir, e } = fresh();
  writeFileSync(join(dir, '..', 'secret.txt'), 'top secret');
  const dump = w.exportJSON();
  dump.entities[e.id].files = [{ id: '../secret.txt', name: 's', size: 10, mime: 'text/plain', createdAt: new Date().toISOString() }];
  assert.throws(() => w.importJSON(dump), /file id/i);
  const out = w.exportJSON();
  assert.equal(out.fileBlobs, undefined, 'no out-of-tree bytes come back through export');
  assert.deepEqual(out.entities[e.id].files, []);
});

test('an import whose logo id leaves files/ is refused', () => {
  const { w, dir } = fresh();
  writeFileSync(join(dir, '..', 'logo.png'), 'not your logo');
  const dump = w.exportJSON();
  dump.meta.logo = { id: '../logo.png', name: 'l', size: 1, mime: 'image/png', createdAt: new Date().toISOString() };
  assert.throws(() => w.importJSON(dump), /file id/i);
  assert.throws(() => w.getWorkspaceLogo(), /no logo/i);
});

test('a hostile id already in state cannot reach outside files/ on read', () => {
  const { w, dir, e } = fresh();
  writeFileSync(join(dir, '..', 'secret.txt'), 'top secret');
  // As if a crafted .db were opened: the id is in state without an import.
  w.state.entities[e.id].files.push({ id: '../secret.txt', name: 's', size: 10, mime: 'text/plain' });
  w.state.meta.logo = { id: '../secret.txt', name: 'l', size: 1, mime: 'image/png' };
  assert.throws(() => w.readFile('../secret.txt'), /file id/i);
  assert.throws(() => w.getWorkspaceLogo(), /file id/i);
  assert.throws(() => w.exportJSON(), /file id/i);
});

test('an in-memory workspace refuses the same ids', () => {
  const w = new Weave({ keystorePath: process.env.WEAVE_KEYSTORE });
  const dump = w.exportJSON();
  dump.fileBlobs = { '../x': Buffer.from('x').toString('base64') };
  assert.throws(() => w.importJSON(dump), /file id/i);
});

test('files and logos the engine mints still round-trip', () => {
  const { w, dir, e } = fresh();
  const f = w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('hello') });
  w.setWorkspaceLogo({ name: 'l.png', bytes: Buffer.from('<svg id="png"/>') });
  const dump = w.exportJSON();
  assert.equal(Buffer.from(dump.fileBlobs[f.id], 'base64').toString(), 'hello');

  const other = fresh();
  other.w.importJSON(dump);
  assert.equal(other.w.readFile(f.id).bytes.toString(), 'hello');
  assert.equal(other.w.getWorkspaceLogo().bytes.toString(), '<svg id="png"/>');
  assert.deepEqual(readdirSync(join(other.dir, 'files')).sort(), [f.id, dump.meta.logo.id].sort());
  assert.ok(existsSync(join(dir, 'files', f.id)));
});
