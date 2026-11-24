import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

async function served(fn, { disk = false } = {}) {
  const w = new Weave(disk ? { path: join(tempDir('weave-ranges-'), 'ws.db') } : {});
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  const e = w.createEntity('Issue', { name: 'Clip' });
  const file = w.attachFile(e.id, { name: 'clip.bin', mime: 'application/octet-stream', bytes: BYTES });
  await withServer(w, async ({ base }) => fn((range) => fetch(`${base}/api/files/${file.id}`, range ? { headers: { Range: range } } : {})));
}

test('a plain file request advertises byte ranges and answers 200 with every byte', () => served(async (get) => {
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BYTES);
}));

test('one satisfiable range answers 206 with Content-Range and only those bytes', () => served(async (get) => {
  const cases = [
    ['bytes=0-99', 0, 99],
    ['bytes=900-', 900, 999],
    ['bytes=-100', 900, 999],
    ['bytes=990-5000', 990, 999],
  ];
  for (const [range, first, last] of cases) {
    const res = await get(range);
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${first}-${last}/1000`, range);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BYTES.subarray(first, last + 1), range);
  }
}));

test('an unsatisfiable range answers 416 with the full size', () => served(async (get) => {
  for (const range of ['bytes=1000-', 'bytes=2000-2100', 'bytes=-0']) {
    const res = await get(range);
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), 'bytes */1000', range);
    await res.arrayBuffer();
  }
}));

test('a multi-range or malformed range gets the full file with 200', () => served(async (get) => {
  for (const range of ['bytes=0-9,20-29', 'items=0-9', 'bytes=abc', 'bytes=9-2']) {
    const res = await get(range);
    assert.equal(res.status, 200, range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BYTES, range);
  }
}));

const onDisk = (fn) => () => served(fn, { disk: true });

test('a file kept on disk answers 200, 206 and 416 the same way a file kept in the database does (Issue #1412)', onDisk(async (get) => {
  const full = await get();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-length'), '1000');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), BYTES);
  for (const [range, first, last] of [['bytes=0-99', 0, 99], ['bytes=900-', 900, 999], ['bytes=-100', 900, 999], ['bytes=990-5000', 990, 999]]) {
    const res = await get(range);
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${first}-${last}/1000`, range);
    assert.equal(res.headers.get('content-length'), String(last - first + 1), range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BYTES.subarray(first, last + 1), range);
  }
  for (const range of ['bytes=1000-', 'bytes=-0']) {
    const res = await get(range);
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), 'bytes */1000', range);
    await res.arrayBuffer();
  }
  for (const range of ['bytes=0-9,20-29', 'bytes=9-2']) {
    const res = await get(range);
    assert.equal(res.status, 200, range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BYTES, range);
  }
}));

test('a download of a file kept on disk streams from the file instead of reading it whole into memory (Issue #1412)', async () => {
  const dir = tempDir('weave-ranges-');
  const w = new Weave({ path: join(dir, 'ws.db') });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  const e = w.createEntity('Issue', { name: 'Clip' });
  const file = w.attachFile(e.id, { name: 'clip.bin', mime: 'application/octet-stream', bytes: BYTES });
  const big = Buffer.alloc(24 * 1024 * 1024, 7);
  big.write('tail', big.length - 4);
  writeFileSync(join(dir, 'files', file.id), big);
  let whole = 0;
  const readFile = w.readFile.bind(w);
  w.readFile = (...args) => { whole += 1; return readFile(...args); };
  await withServer(w, async ({ base }) => {
    const res = await fetch(`${base}/api/files/${file.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(big.length));
    const got = Buffer.from(await res.arrayBuffer());
    assert.equal(got.length, big.length);
    assert.equal(got.subarray(-4).toString(), 'tail');
    const tail = await fetch(`${base}/api/files/${file.id}`, { headers: { Range: 'bytes=-4' } });
    assert.equal(tail.status, 206);
    assert.equal(Buffer.from(await tail.arrayBuffer()).toString(), 'tail');
  });
  assert.equal(whole, 0, 'the download never read the whole blob into a Buffer');
});
