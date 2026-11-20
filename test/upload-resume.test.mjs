import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');

async function serve() {
  const dir = tempDir('weave-upload-resume-');
  const w = new Weave({ path: join(dir, 'ws.db') });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addField('Task', { name: 'Files', type: 'attachments', multiple: true });
  const row = w.createEntity('Task', { Name: 'Receipt' });
  const token = w.createAccount({ name: 'agent', role: 'editor' }).token;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const grant = async (size = PNG.length) => {
    const res = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entity: row.id, field: 'Files', name: 'shot.png', mime: 'image/png', size }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return res.json();
  };
  const put = (g, bytes, offset) => fetch(new URL(g.url, base), {
    method: 'PUT',
    headers: { ...g.headers, ...(offset == null ? {} : { 'Upload-Offset': String(offset) }) },
    body: bytes,
  });
  const head = (g) => fetch(new URL(g.url, base), { method: 'HEAD', headers: { Authorization: g.headers.Authorization } });
  const staged = () => { try { return readdirSync(join(dir, 'uploads')); } catch { return []; } };
  return { w, row, dir, grant, put, head, staged, stop: () => server.close() };
}

test('a workspace that keeps files on disk prepares a resumable upload that starts at offset 0', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    assert.equal(g.resumable, true);
    const res = await s.head(g);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('upload-offset'), '0');
    assert.equal(res.headers.get('upload-length'), String(PNG.length));
  } finally { s.stop(); }
});

test('a cut upload keeps the bytes that arrived, and the rest lands from that offset', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    const cut = await s.put(g, PNG.subarray(0, 10), 0);
    assert.equal(cut.status, 400);
    assert.equal((await cut.json()).code, 'incomplete-upload');
    assert.equal(cut.headers.get('upload-offset'), '10', 'the cut answer names how far the bytes got');
    const probe = await s.head(g);
    assert.equal(probe.status, 204, 'the grant stays live after a cut so the browser can resume');
    assert.equal(probe.headers.get('upload-offset'), '10');
    const rest = await s.put(g, PNG.subarray(10), 10);
    assert.equal(rest.status, 201, await rest.clone().text());
    const file = await rest.json();
    assert.deepEqual(readFileSync(join(s.dir, 'files', file.id)), PNG);
    assert.deepEqual(s.w.getEntity(s.row.id).values[s.w.getField('Task', 'Files').id], [file.id]);
    assert.deepEqual(s.staged(), [], 'a landed resumable upload left its staging file behind');
    assert.equal((await s.head(g)).status, 401, 'a landed grant is spent');
  } finally { s.stop(); }
});

test('a chunk sent from the wrong offset is refused with the offset the server holds', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    await s.put(g, PNG.subarray(0, 8), 0);
    const wrong = await s.put(g, PNG.subarray(4), 4);
    assert.equal(wrong.status, 409);
    assert.equal((await wrong.json()).code, 'offset-mismatch', 'a browser re-send after a reset reads as a lost connection');
    assert.equal(wrong.headers.get('upload-offset'), '8');
    assert.equal((await s.head(g)).headers.get('upload-offset'), '8', 'a refused chunk changed the held bytes');
  } finally { s.stop(); }
});

test('a chunk past the prepared size is refused and leaves the held bytes as they were', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    await s.put(g, PNG.subarray(0, 8), 0);
    const over = await s.put(g, Buffer.alloc(PNG.length), 8);
    assert.equal(over.status, 413);
    assert.equal((await s.head(g)).headers.get('upload-offset'), '8');
    const rest = await s.put(g, PNG.subarray(8), 8);
    assert.equal(rest.status, 201, await rest.clone().text());
  } finally { s.stop(); }
});

test('an expired resumable grant drops its staged bytes', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    await s.put(g, PNG.subarray(0, 8), 0);
    assert.equal(s.staged().length, 1);
    const now = Date.now;
    Date.now = () => now() + 11 * 60 * 1000;
    try { assert.equal((await s.head(g)).status, 401); } finally { Date.now = now; }
    assert.deepEqual(s.staged(), []);
  } finally { s.stop(); }
});

test('a resume keeps the grant alive past its first ten minutes', async () => {
  const s = await serve();
  try {
    const g = await s.grant();
    const now = Date.now;
    try {
      Date.now = () => now() + 8 * 60 * 1000;
      await s.put(g, PNG.subarray(0, 8), 0);
      Date.now = () => now() + 16 * 60 * 1000;
      assert.equal((await s.put(g, PNG.subarray(8), 8)).status, 201);
    } finally { Date.now = now; }
  } finally { s.stop(); }
});

test('a workspace that keeps files in its database prepares a one-shot upload', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addField('Task', { name: 'Files', type: 'attachments' });
  const row = w.createEntity('Task', { Name: 'Receipt' });
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/uploads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: row.id, field: 'Files', name: 'a.txt', mime: 'text/plain', size: 3 }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal((await res.json()).resumable, false);
  } finally { server.close(); }
});
