import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave, WeaveError, PREVIEW_MAX_BYTES } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { inspect } from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

await import('../public/file-preview-core.js');
const P = globalThis.WeavePreview;

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000fa000000bb80802000000', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 7)]);

function seed(dir = tempDir('weave-preview-')) {
  const w = new Weave({ path: join(dir, 'ws.db') });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deck' });
  w.addField('Deck', { name: 'Shots', type: 'attachments' });
  const e = w.createEntity('Deck', { name: 'Q3' });
  return { w, dir, entity: e.id };
}

test('an image upload keeps its preview beside the original, recorded on the file entry', () => {
  const { w, dir, entity } = seed();
  const file = w.attachToField(entity, 'Shots', { name: 'shot.png', mime: 'image/png', bytes: PNG, preview: { bytes: WEBP } });
  assert.equal(file.preview?.mime, 'image/webp');
  assert.equal(file.preview?.size, WEBP.length);
  assert.ok(existsSync(join(dir, 'files', file.preview.id)), 'the preview blob is not stored beside the original');
  assert.deepEqual(w.readFile(file.id, { preview: true }).bytes, WEBP);
  assert.equal(w.readFile(file.id, { preview: true }).meta.mime, 'image/webp');
  assert.deepEqual(w.readFile(file.id).bytes, PNG, 'the original is no longer what a plain read returns');
  assert.equal(w.readEntity(entity).files[0].preview.id, file.preview.id);
});

test('a file with no preview falls back to the original', () => {
  const { w, entity } = seed();
  const file = w.attachToField(entity, 'Shots', { name: 'old.png', mime: 'image/png', bytes: PNG });
  assert.equal(file.preview, undefined);
  const r = w.readFile(file.id, { preview: true });
  assert.deepEqual(r.bytes, PNG);
  assert.equal(r.meta.mime, 'image/png');
});

test('a preview must be an image, and only an image takes one', () => {
  const { w, entity } = seed();
  assert.throws(() => w.attachToField(entity, 'Shots', { name: 'a.png', mime: 'image/png', bytes: PNG, preview: { bytes: Buffer.from('<svg/>') } }),
    (e) => e instanceof WeaveError && e.code === 'unsupported-type');
  assert.throws(() => w.attachToField(entity, 'Shots', { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('hi'), preview: { bytes: WEBP } }),
    (e) => e instanceof WeaveError && e.code === 'unsupported-type');
  assert.throws(() => w.attachToField(entity, 'Shots', { name: 'a.png', mime: 'image/png', bytes: PNG, preview: { bytes: Buffer.concat([WEBP, Buffer.alloc(P.MAX_BYTES)]) } }),
    (e) => e instanceof WeaveError && e.code === 'invalid');
  assert.equal(w.readEntity(entity).files.length, 0, 'a refused preview left a file behind');
});

test('deleting a file deletes its preview, and purging the row does too', () => {
  const { w, dir, entity } = seed();
  const a = w.attachToField(entity, 'Shots', { name: 'a.png', mime: 'image/png', bytes: PNG, preview: { bytes: WEBP } });
  const b = w.attachToField(entity, 'Shots', { name: 'b.png', mime: 'image/png', bytes: PNG, preview: { bytes: WEBP } });
  w.deleteFile(entity, a.id);
  assert.equal(existsSync(join(dir, 'files', a.id)), false);
  assert.equal(existsSync(join(dir, 'files', a.preview.id)), false, 'the preview outlived its file');
  w.deleteEntity(entity, { hard: true });
  assert.equal(existsSync(join(dir, 'files', b.preview.id)), false, 'the preview outlived its purged row');
});

test('previews count toward storage, export, import and backup like the original', () => {
  const { w, entity } = seed();
  const before = w.storageStats().sizeBytes;
  const file = w.attachToField(entity, 'Shots', { name: 'a.png', mime: 'image/png', bytes: PNG, preview: { bytes: WEBP } });
  assert.ok(w.storageStats().sizeBytes - before >= PNG.length + WEBP.length, 'storage left the preview out');
  const dump = JSON.parse(JSON.stringify(w.exportJSON()));
  assert.equal(dump.fileBlobs?.[file.preview.id], WEBP.toString('base64'), 'the export dropped the preview');
  const dst = new Weave({ path: join(tempDir('weave-preview-'), 'dst.db') });
  dst.importJSON(dump);
  assert.deepEqual(dst.readFile(file.id, { preview: true }).bytes, WEBP, 'the import lost the preview');
  const refs = inspect(w.store.path).refs.map((r) => r.id);
  assert.ok(refs.includes(file.preview.id), 'a scoped backup would leave the preview behind');
});

test('the files routes take a preview and ?preview serves it, falling back to the original', async () => {
  const { w, entity } = seed();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const withPreview = await post(`/entities/${entity}/fields/Shots/files`, {
      name: 'a.png', mime: 'image/png', bytes: PNG.toString('base64'), preview: { contentBase64: WEBP.toString('base64') },
    });
    const plain = await post(`/entities/${entity}/files`, { name: 'b.png', mime: 'image/png', contentBase64: PNG.toString('base64') });
    const small = await fetch(`${base}/files/${withPreview.id}?preview`);
    assert.equal(small.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await small.arrayBuffer()), WEBP);
    const full = await fetch(`${base}/files/${withPreview.id}`);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), PNG);
    const old = await fetch(`${base}/files/${plain.id}?preview`);
    assert.deepEqual(Buffer.from(await old.arrayBuffer()), PNG, 'a file with no preview did not fall back to the original');
  } finally { server.close(); }
});

test('the client preview core sizes the canvas and picks the cell source', () => {
  assert.equal(P.MAX_SIDE, 320);
  assert.equal(P.MAX_BYTES, PREVIEW_MAX_BYTES, 'the browser and the engine disagree on the preview cap');
  assert.deepEqual(P.box(4000, 3000), { width: 320, height: 240 });
  assert.deepEqual(P.box(1000, 4000), { width: 80, height: 320 });
  assert.equal(P.box(300, 200), null, 'an image already small enough gets no preview');
  assert.equal(P.box(0, 0), null);
  assert.equal(P.takes('image/jpeg'), true);
  assert.equal(P.takes('image/png'), true);
  assert.equal(P.takes('image/webp'), true);
  assert.equal(P.takes('image/gif'), false, 'a GIF keeps its animation');
  assert.equal(P.takes('application/pdf'), false);
  assert.equal(P.src({ id: 'f1', preview: { id: 'p1' } }, '/w/x'), '/w/x/api/files/f1?preview');
  assert.equal(P.src({ id: 'f2' }, '/w/x'), '/w/x/api/files/f2', 'a file uploaded before previews falls back to the original');
  assert.equal(P.src({ id: 'f3' }, ''), '/api/files/f3');
});
