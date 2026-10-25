import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), 'weave-files-delete-'));
  const w = new Weave({ path: join(dir, 'ws.db') });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const task = w.createEntity('Task', { Name: 'Receipt' });
  const file = w.attachFile(task.id, { name: 'note.txt', mime: 'text/plain', bytes: Buffer.from('hello') });
  const blob = join(dir, 'files', file.id);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path) => {
    const res = await fetch(base + path, { method });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { w, task, file, blob, call, stop: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('DELETE /api/entities/:id/files/:file unlinks the blob and drops the file from the entity', async () => {
  const { w, task, file, blob, call, stop } = await serve();
  try {
    assert.ok(existsSync(blob), 'the upload landed beside the workspace');
    assert.equal((await call('GET', `/api/files/${file.id}`)).status, 200);
    const ok = await call('DELETE', `/api/entities/${task.id}/files/${file.id}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
    assert.equal(existsSync(blob), false, 'the blob is unlinked from disk');
    assert.deepEqual(w.readEntity(task.id).files, []);
    assert.equal((await call('GET', `/api/files/${file.id}`)).status, 404, 'the file no longer reads back');
  } finally {
    stop();
  }
});

test('DELETE of a file: an unknown entity is a 404, a malformed id a 400, and a second DELETE answers 200 (Issue #1087)', async () => {
  const { w, task, file, call, stop } = await serve();
  try {
    const ghost = await call('DELETE', `/api/entities/no-such-entity/files/${file.id}`);
    assert.equal(ghost.status, 404);
    assert.equal(ghost.json.code, 'not-found');
    const malformed = await call('DELETE', `/api/entities/${task.id}/files/not-a-blob`);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.code, 'invalid');
    assert.equal(w.readEntity(task.id).files.length, 1, 'a refused DELETE keeps the file');

    assert.equal((await call('DELETE', `/api/entities/${task.id}/files/${file.id}`)).status, 200);
    const again = await call('DELETE', `/api/entities/${task.id}/files/${file.id}`);
    assert.equal(again.status, 200, 'Issue #1087: a miss reads as success today');
    assert.deepEqual(again.json, { ok: true });
  } finally {
    stop();
  }
});
