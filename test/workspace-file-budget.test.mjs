import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Weave, workspaceFileMaxBytes, mbText } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const VAR = 'WEAVE_WORKSPACE_FILE_MAX_MB';

function seeded(path = null) {
  const w = new Weave(path ? { path } : undefined);
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Deck' });
  w.addField('Deck', { name: 'Files', type: 'attachments' });
  return w;
}

async function withBudget(mb, run) {
  const had = Object.hasOwn(process.env, VAR);
  const was = process.env[VAR];
  if (mb == null) delete process.env[VAR];
  else process.env[VAR] = String(mb);
  try {
    return await run();
  } finally {
    if (had) process.env[VAR] = was;
    else delete process.env[VAR];
  }
}

const blobBytes = (dir) => readdirSync(join(dir, 'files')).reduce((n, f) => n + statSync(join(dir, 'files', f)).size, 0);

test('storageStats counts this workspace file bytes apart from its database', () => {
  const w = seeded();
  assert.equal(w.storageStats().fileBytes, 0, 'a fresh workspace holds no file bytes');
  const e = w.createEntity('Deck', { name: 'Acme' });
  const file = w.attachToField(e.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.alloc(4096) });
  assert.equal(w.storageStats().fileBytes, 4096, 'an attach adds its bytes to the total');
  w.deleteFile(e.id, file.id);
  assert.equal(w.storageStats().fileBytes, 0, 'a delete takes them back off');
});

test('the file total is rebuilt on load and matches the blobs on the volume', () => {
  const dir = tempDir('weave-file-budget-');
  try {
    const path = join(dir, 'ws.db');
    const w = seeded(path);
    const e = w.createEntity('Deck', { name: 'Acme' });
    w.attachToField(e.id, 'Files', { name: 'one.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(3000) });
    w.attachToField(e.id, 'Files', { name: 'two.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(5000) });
    assert.equal(w.storageStats().fileBytes, 8000);
    assert.equal(blobBytes(dir), 8000, 'the total is what the volume holds');
    const again = new Weave({ path });
    assert.equal(again.storageStats().fileBytes, 8000, 'a reload rebuilds the total from the workspace');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no workspace budget is set unless an operator sets one', async () => {
  assert.equal(await withBudget(null, () => workspaceFileMaxBytes()), 0, 'unset is no limit');
  assert.equal(await withBudget('0', () => workspaceFileMaxBytes()), 0);
  assert.equal(await withBudget('not a number', () => workspaceFileMaxBytes()), 0, 'a value that is not a size is no limit');
  assert.equal(await withBudget('64', () => workspaceFileMaxBytes()), 64 * 1024 * 1024, 'the operator writes megabytes');
  const w = seeded();
  const e = w.createEntity('Deck', { name: 'Acme' });
  await withBudget(null, () => w.attachToField(e.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.alloc(2048) }));
  assert.equal(w.storageStats().fileBytes, 2048, 'counting runs whether or not a budget is set');
  assert.equal(w.storageStats().fileLimitBytes, 0, 'health carries the budget so a client can warn before it bites');
});

test('an attach past the workspace budget is refused with storage-full, naming the total and the limit', async () => {
  const w = seeded();
  const e = w.createEntity('Deck', { name: 'Acme' });
  await withBudget(1, () => {
    w.attachToField(e.id, 'Files', { name: 'half.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(600 * 1024) });
    assert.equal(w.storageStats().fileLimitBytes, 1024 * 1024);
    assert.throws(
      () => w.attachToField(e.id, 'Files', { name: 'rest.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(600 * 1024) }),
      (err) => err.code === 'storage-full'
        && err.message.includes(mbText(600 * 1024))
        && err.message.includes(mbText(1024 * 1024))
        && err.message.includes('rest.bin'),
    );
  });
  assert.equal(w.getEntity(e.id).files.length, 1, 'the refused file still landed');
  assert.equal(w.storageStats().fileBytes, 600 * 1024, 'and still counts');
});

test('the attach route answers 507 storage-full once the workspace is over its budget', async () => {
  const w = seeded();
  const e = w.createEntity('Deck', { name: 'Acme' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await withBudget(1, async () => {
      const post = (bytes) => fetch(`${base}/api/entities/${e.id}/fields/Files/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'blob.bin', mime: 'application/octet-stream', bytes: Buffer.alloc(bytes).toString('base64') }),
      });
      assert.equal((await post(600 * 1024)).status, 201);
      const res = await post(600 * 1024);
      assert.equal(res.status, 507, 'the error contract already carries storage-full');
      const body = await res.json();
      assert.equal(body.code, 'storage-full');
      assert.match(body.error, /1\.0 MB/, 'the refusal names the limit');
    });
  } finally { server.close(); }
});

test('health carries the file total and the budget for the upload tile', async () => {
  const w = seeded();
  const e = w.createEntity('Deck', { name: 'Acme' });
  w.attachToField(e.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.alloc(2048) });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await withBudget(8, async () => {
      const h = await (await fetch(`${base}/api/health`)).json();
      assert.equal(h.fileBytes, 2048);
      assert.equal(h.fileLimitBytes, 8 * 1024 * 1024);
      assert.ok(h.sizeBytes >= h.fileBytes, 'sizeBytes still carries the database and the files together');
    });
  } finally { server.close(); }
});
