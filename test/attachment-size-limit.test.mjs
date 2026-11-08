import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, FILE_MAX_BYTES } from '../src/engine.js';
import { MAX_BODY_BYTES, MAX_ATTACH_BODY_BYTES } from '../src/routes.js';
import { startServer } from '../src/server.js';

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Deck' });
  w.addField('Deck', { name: 'Files', type: 'attachments' });
  return w;
}

const base64 = (bytes) => Buffer.alloc(bytes).toString('base64');

async function serve(w) {
  const { server } = await startServer(w, { port: 0 });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const post = (base, entity, body) => fetch(`${base}/api/entities/${entity}/fields/Files/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('the limit is the file size, so a file at the documented limit lands', () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const file = w.attachToField(e.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.alloc(FILE_MAX_BYTES) });
  assert.equal(file.size, FILE_MAX_BYTES);
  assert.equal(FILE_MAX_BYTES, 10 * 1024 * 1024, 'the engine limit is the 10 MiB the handbook documents');
});

test('a file past the limit is refused by size, naming the file and the limit', () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  assert.throws(
    () => w.attachToField(e.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.alloc(25 * 1024 * 1024) }),
    (err) => err.code === 'too-large' && err.message === 'deck.pdf is 25.0 MB; files can be up to 10.0 MB',
  );
  assert.deepEqual(w.getEntity(e.id).files, [], 'the refused file still landed');
});

test('the attach route answers 413 and names the file and the limit', async () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  try {
    const res = await post(base, e.id, { name: 'deck.pdf', mime: 'application/pdf', bytes: base64(10.2 * 1024 * 1024) });
    assert.equal(res.status, 413, 'an oversized file still answers 400 invalid');
    const body = await res.json();
    assert.equal(body.code, 'too-large');
    assert.equal(body.error, 'deck.pdf is 10.2 MB; files can be up to 10.0 MB');
    assert.equal(body.limit, FILE_MAX_BYTES, 'the 413 body names no limit in bytes');
  } finally { close(); }
});

test('a body too big for the attach route answers 413 with the limit, not 400 invalid', async () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  try {
    const res = await post(base, e.id, { name: 'huge.zip', mime: 'application/zip', bytes: base64(25 * 1024 * 1024) });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.code, 'too-large');
    assert.match(body.error, /10\.0 MB/, 'the refusal names no limit');
    assert.equal(body.limit, FILE_MAX_BYTES, 'the 413 body names no limit in bytes');
  } finally { close(); }
});

test('a file at the limit rides the JSON attach route, base64 and all', async () => {
  const w = fresh();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { base, close } = await serve(w);
  try {
    const res = await post(base, e.id, { name: 'ten.bin', mime: 'application/octet-stream', bytes: base64(FILE_MAX_BYTES) });
    assert.equal(res.status, 201, 'base64 inflation still decides the limit');
    assert.equal((await res.json()).size, FILE_MAX_BYTES);
  } finally { close(); }
});

test('the attach body cap carries a file at the limit plus its preview, and nothing else grew', () => {
  assert.ok(MAX_ATTACH_BODY_BYTES > Math.ceil((FILE_MAX_BYTES * 4) / 3), 'a file at the limit does not fit the attach body cap as base64');
  assert.equal(MAX_BODY_BYTES, 10 * 1024 * 1024, 'the cap on every other route moved');
});

test('the browser refuses the same size the engine does', () => {
  const app = readFileSync(new URL('../public/upload-core.js', import.meta.url), 'utf8');
  const m = app.match(/^  const LIMIT = (.+);$/m);
  assert.ok(m, 'public/upload-core.js names no file size limit');
  assert.equal(Number(eval(m[1])), FILE_MAX_BYTES, 'the browser and the engine disagree on the file size limit');
});
