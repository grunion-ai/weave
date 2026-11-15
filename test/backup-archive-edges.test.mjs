import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { backup, packTar, streamTar } from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

const BLOCK = 512;
const PASS = 'correct horse battery staple';

async function collect(chunks) {
  const got = [];
  await streamTar(chunks, (name) => {
    const parts = [];
    return { write: (b) => parts.push(Buffer.from(b)), close: () => got.push({ name, data: Buffer.concat(parts) }) };
  });
  return got;
}

const unterminated = (whole) => {
  let end = whole.length;
  while (end >= BLOCK && whole.subarray(end - BLOCK, end).every((b) => b === 0)) end -= BLOCK;
  return whole.subarray(0, end);
};

test('a tar stream that ends exactly after its last entry, with no end marker, is accepted', async () => {
  const dir = tempDir('weave-tar-edge-');
  const file = join(dir, 'x.tar');
  packTar(file, [{ name: 'one.txt', data: Buffer.from('first entry') }, { name: 'two.txt', data: Buffer.from('second entry') }]);
  const whole = readFileSync(file);
  const bare = unterminated(whole);
  assert.ok(bare.length < whole.length, 'the end marker was cut off');
  assert.equal(bare.length % BLOCK, 0);
  const got = await collect([bare]);
  assert.deepEqual(got.map((e) => [e.name, e.data.toString()]), [['one.txt', 'first entry'], ['two.txt', 'second entry']]);
});

test('an empty tar stream is accepted and delivers nothing', async () => {
  assert.deepEqual(await collect([]), []);
});

test('a tar stream cut inside the padding of its last entry is refused as truncated', async () => {
  const dir = tempDir('weave-tar-edge-');
  const file = join(dir, 'x.tar');
  packTar(file, [{ name: 'one.txt', data: Buffer.from('first entry') }]);
  const bare = unterminated(readFileSync(file));
  await assert.rejects(collect([bare.subarray(0, bare.length - 10)]), /Tar archive truncated at byte/);
});

test('a cloud backup whose upload answer names no pruned archives reports none', async () => {
  const data = tempDir('weave-backup-edge-data-');
  const w = new Weave({ path: join(data, 'alpha.db') });
  w.state.meta.name = 'alpha';
  w.createSpace({ name: 'Ops' });
  w.store.close?.();
  const sent = [];
  const fetchImpl = async (url, { method, body }) => {
    sent.push(method);
    if (typeof body?.getReader === 'function') await new Response(body).arrayBuffer();
    return Response.json({});
  };
  const r = await backup({ dataDir: data, out: tempDir('weave-backup-edge-out-'), dest: 'weave://127.0.0.1:1/alice', env: { WEAVE_BACKUP_TOKEN: 'wv_test', WEAVE_BACKUP_PASSPHRASE: PASS }, fetchImpl });
  assert.deepEqual(sent, ['PUT']);
  assert.equal(r.uploaded, `weave://127.0.0.1:1/alice/${r.archive}`);
  assert.deepEqual(r.pruned, []);
});

test('a cloud backup reports the archives the account pruned to stay under its quota', async () => {
  const data = tempDir('weave-backup-edge-data-');
  const w = new Weave({ path: join(data, 'alpha.db') });
  w.state.meta.name = 'alpha';
  w.store.close?.();
  const fetchImpl = async (url, { body }) => {
    if (typeof body?.getReader === 'function') await new Response(body).arrayBuffer();
    return Response.json({ pruned: ['weave-backup-old.tar.enc'] });
  };
  const r = await backup({ dataDir: data, out: tempDir('weave-backup-edge-out-'), dest: 'weave://127.0.0.1:1/alice', env: { WEAVE_BACKUP_TOKEN: 'wv_test', WEAVE_BACKUP_PASSPHRASE: PASS }, fetchImpl });
  assert.deepEqual(r.pruned, ['weave-backup-old.tar.enc']);
});
