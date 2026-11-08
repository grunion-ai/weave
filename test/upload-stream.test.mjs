import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave, FILE_MAX_BYTES } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function serve({ accounts = true } = {}) {
  const dir = tempDir('weave-upload-stream-');
  const w = new Weave({ path: join(dir, 'ws.db') });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addField('Task', { name: 'Files', type: 'attachments', multiple: true });
  w.addField('Task', { name: 'Face', type: 'avatar' });
  const row = w.createEntity('Task', { Name: 'Receipt' });
  const token = accounts ? w.createAccount({ name: 'agent', role: 'editor' }).token : null;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  const prepare = (body) => fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(body),
  });
  const put = (grant, bytes) => fetch(new URL(grant.url, base), { method: 'PUT', headers: grant.headers, body: bytes });
  return { w, row, dir, base, auth, prepare, put, stop: () => server.close() };
}

test('a signed-in caller prepares an upload over HTTP and streams the bytes into an attachments field (Issue #1428)', async () => {
  const s = await serve();
  try {
    const res = await s.prepare({ entity: s.row.id, field: 'Files', name: 'shot.png', mime: 'image/png', size: PNG.length });
    assert.equal(res.status, 201, await res.clone().text());
    const grant = await res.json();
    assert.equal(grant.method, 'PUT');
    assert.equal(grant.maxBytes, PNG.length);
    assert.equal(grant.url, '/api/uploads', 'a browser sends the body to its own origin, so the grant host matches the request');
    const landed = await s.put(grant, PNG);
    assert.equal(landed.status, 201, await landed.clone().text());
    const file = await landed.json();
    assert.equal(file.size, PNG.length);
    assert.deepEqual(readFileSync(join(s.dir, 'files', file.id)), PNG);
    assert.deepEqual(s.w.getEntity(s.row.id).values[s.w.getField('Task', 'Files').id], [file.id]);
  } finally { s.stop(); }
});

test('a streamed upload leaves no staging file behind, whether it lands or is refused (Issue #1428)', async () => {
  const s = await serve();
  try {
    const good = await s.prepare({ entity: s.row.id, name: 'note.txt', mime: 'text/plain', size: 5 }).then((r) => r.json());
    assert.equal((await s.put(good, Buffer.from('hello'))).status, 201);
    const short = await s.prepare({ entity: s.row.id, name: 'note.txt', mime: 'text/plain', size: 5 }).then((r) => r.json());
    assert.equal((await s.put(short, Buffer.from('hi'))).status, 400);
    const over = await s.prepare({ entity: s.row.id, name: 'note.txt', mime: 'text/plain', size: 5 }).then((r) => r.json());
    assert.equal((await s.put(over, Buffer.from('far too long'))).status, 413);
    assert.deepEqual(readdirSync(join(s.dir, 'files')).filter((n) => n.endsWith('.upload')), [], 'no staging file is left in files/');
  } finally { s.stop(); }
});

test('a prepared upload carries a preview, and the size limit counts the file itself (Issue #1428)', async () => {
  const s = await serve();
  try {
    const grant = await s.prepare({
      entity: s.row.id, field: 'Files', name: 'shot.png', mime: 'image/png', size: PNG.length,
      preview: { contentBase64: PNG.toString('base64') },
    }).then((r) => r.json());
    const file = await s.put(grant, PNG).then((r) => r.json());
    assert.equal(s.w.readFileMeta(file.id).preview.mime, 'image/png');
    assert.ok(existsSync(join(s.dir, 'files', s.w.readFileMeta(file.id).preview.id)));
    const tooBig = await s.prepare({ entity: s.row.id, name: 'big.bin', mime: 'application/octet-stream', size: FILE_MAX_BYTES + 1 });
    assert.equal(tooBig.status, 400);
    const atLimit = await s.prepare({ entity: s.row.id, name: 'big.bin', mime: 'application/octet-stream', size: FILE_MAX_BYTES });
    assert.equal(atLimit.status, 201, 'the 10 MiB limit is the file size, without base64 overhead');
  } finally { s.stop(); }
});

test('an avatar field takes its bytes, not a streamed upload (Issue #1428)', async () => {
  const s = await serve();
  try {
    const refused = await s.prepare({ entity: s.row.id, field: 'Face', name: 'me.png', mime: 'image/png', size: PNG.length });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /attachments field/);
    assert.throws(() => s.w.attachToField(s.row.id, 'Face', { name: 'me.png', mime: 'image/png', staged: { id: 'x', size: 1 } }), /not through a streamed upload/);
  } finally { s.stop(); }
});

test('a workspace with no accounts still prepares and streams an upload; the JSON attach path stays (Issue #1428)', async () => {
  const s = await serve({ accounts: false });
  try {
    const grant = await s.prepare({ entity: s.row.id, name: 'note.txt', mime: 'text/plain', size: 5 }).then((r) => r.json());
    assert.equal((await s.put(grant, Buffer.from('hello'))).status, 201);
    const json = await fetch(`${s.base}/api/entities/${s.row.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'json.txt', mime: 'text/plain', contentBase64: Buffer.from('still here').toString('base64') }),
    });
    assert.equal(json.status, 201, await json.clone().text());
    assert.deepEqual(s.w.readFile((await json.json()).id).bytes, Buffer.from('still here'));
  } finally { s.stop(); }
});
