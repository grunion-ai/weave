import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startSupervisor } from '../src/supervisor.js';
import { tempDir } from './lib/temp.mjs';

const scratch = tempDir('weave-hop-');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const ENV = { ...process.env, WEAVE_UPDATE_CHECK: 'off' };
delete ENV.WEAVE_AUTO_UPDATE;
delete ENV.WEAVE_DEFER_MIGRATIONS;
delete ENV.WEAVE_DEPLOY_TOKEN;

const ECHO_WORKER = `import { createServer } from 'node:http';
const s = createServer((q, r) => {
  r.setHeader('content-type', 'application/json');
  if (q.url.startsWith('/api/health')) return r.end(JSON.stringify({ ok: true, name: 'weave', version: '1.0.0' }));
  r.setHeader('connection', 'close');
  r.setHeader('keep-alive', 'timeout=99');
  r.end(JSON.stringify({ connection: q.headers.connection ?? null, keepAlive: q.headers['keep-alive'] ?? null, trace: q.headers['x-trace'] ?? null }));
});
s.listen(0, '127.0.0.1', () => process.send({ weave: 'listening', port: s.address().port, version: '1.0.0' }));
`;

function fakeImage() {
  const dir = join(scratch, 'image');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'weave', version: '1.0.0', type: 'module' }));
  writeFileSync(join(dir, 'bin', 'weave.js'), ECHO_WORKER);
  return dir;
}

function seed() {
  const dir = join(scratch, 'data');
  mkdirSync(dir, { recursive: true });
  const dataPath = join(dir, 'weave.db');
  const w = new Weave({ path: dataPath });
  w.state.meta.name = 'weave';
  w.save();
  w.store.close();
  return dataPath;
}

function get(port, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/echo', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ headers: res.headers, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the supervisor proxy drops hop-by-hop headers in both directions', async () => {
  const sup = await startSupervisor({
    port: 0, host: '127.0.0.1', dataPath: seed(), imageDir: fakeImage(), env: ENV,
    fetch: async () => new Response('not found', { status: 404 }),
    interval: 0, watchMs: 0, log: { log() {}, warn() {}, error() {} },
    onWorkerDied: () => { throw new Error('a worker died under the supervisor'); },
  });
  try {
    const answer = await get(sup.port, { Connection: 'keep-alive', 'Keep-Alive': 'timeout=5', 'X-Trace': 'kept' });
    assert.notEqual(answer.body.connection, 'keep-alive', 'the client connection header is not handed to the worker');
    assert.equal(answer.body.keepAlive, null, 'the client keep-alive header is not handed to the worker');
    assert.equal(answer.body.trace, 'kept', 'an end-to-end header still passes');
    assert.equal(answer.headers.connection, 'keep-alive', 'the worker connection header does not reach the client');
    assert.notEqual(answer.headers['keep-alive'], 'timeout=99', 'the worker keep-alive header does not reach the client');
  } finally {
    await sup.close();
  }
});
