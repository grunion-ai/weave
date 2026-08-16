import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // png magic + header start

test('workspace logo: set / read / delete on a file-backed workspace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-logo-'));
  const w = new Weave({ path: join(dir, 'ws.db') });
  assert.throws(() => w.getWorkspaceLogo(), WeaveError);

  const meta = w.setWorkspaceLogo({ name: 'logo.png', mime: 'image/png', bytes: PNG });
  assert.equal(meta.name, 'logo.png');
  assert.ok(existsSync(join(dir, 'files', meta.id)));

  const got = w.getWorkspaceLogo();
  assert.equal(got.meta.mime, 'image/png');
  assert.deepEqual(got.bytes, PNG);

  // Survives reopen (meta.logo persists through the store).
  const w2 = new Weave({ path: join(dir, 'ws.db') });
  assert.deepEqual(w2.getWorkspaceLogo().bytes, PNG);

  // Replacing swaps the blob; deleting removes meta.
  const meta2 = w2.setWorkspaceLogo({ name: 'v2.png', mime: 'image/png', bytes: Buffer.from('next') });
  assert.notEqual(meta2.id, meta.id);
  w2.deleteWorkspaceLogo();
  assert.throws(() => w2.getWorkspaceLogo(), WeaveError);
});

test('workspace logo: in-memory fallback works', () => {
  const w = new Weave();
  w.setWorkspaceLogo({ name: 'l.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg/>').toString('base64') });
  assert.equal(w.getWorkspaceLogo().bytes.toString(), '<svg/>');
});

test('REST: logo upload, serving, listing flag, delete', async () => {
  const w = new Weave();
  w.state.meta.name = 'uno';
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/workspace/logo`)).status, 404);

    const put = await fetch(`${base}/api/workspace/logo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'logo.png', mime: 'image/png', contentBase64: PNG.toString('base64') }),
    });
    assert.equal(put.status, 200);

    const got = await fetch(`${base}/api/workspace/logo`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG);

    const list = await (await fetch(`${base}/api/workspaces`)).json();
    assert.equal(list.find((x) => x.name === 'uno').logo, true);

    assert.equal((await fetch(`${base}/api/workspace/logo`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/workspace/logo`)).status, 404);
  } finally {
    server.close();
  }
});

test("server alias: /w/weaver/ requests reach the renamed 'weave' workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-alias-'));
  const main = new Weave({ path: join(dir, 'main.db') });
  main.state.meta.name = 'main';
  main.save();
  const docs = new Weave({ path: join(dir, 'weave.db') });
  docs.state.meta.name = 'weave';
  docs.save();
  const { server } = await startServer(main, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/w/weaver/api/health`)).json();
    assert.equal(health.workspace, 'weave');
  } finally {
    server.close();
  }
});
