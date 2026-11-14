import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

async function served(fn) {
  const w = new Weave();
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
