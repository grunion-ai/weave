import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE ??= join(tempDir('weave-sec-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startSupervisor } = await import('../../src/supervisor.js');

const TOKEN = 'k'.repeat(40);
const HEADER = 'x-weave-deploy-token';
const ANONYMOUS = { ok: true, name: 'weave' };
const ENV = { ...process.env, WEAVE_UPDATE_CHECK: 'off' };
for (const key of ['WEAVE_AUTO_UPDATE', 'WEAVE_DEFER_MIGRATIONS', 'WEAVE_TRACK', 'WEAVE_DEPLOY_TOKEN']) delete ENV[key];

function walledData() {
  const dir = tempDir('weave-supervised-health-');
  const w = new Weave({ path: join(dir, 'weave.db') });
  w.state.meta.name = 'weave';
  w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  w.store.close();
  return join(dir, 'weave.db');
}

function echoingImage() {
  const dir = tempDir('weave-echo-image-');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'weave', version: '0.0.1' }));
  writeFileSync(join(dir, 'bin', 'weave.js'), `import { createServer } from 'node:http';
const s = createServer((q, r) => {
  r.setHeader('content-type', 'application/json');
  r.end(JSON.stringify({ ok: true, name: 'weave', saw: q.headers['${HEADER}'] ?? null }));
});
s.listen(0, '127.0.0.1', () => process.send({ weave: 'listening', port: s.address().port, version: '0.0.1' }));
`);
  return dir;
}

async function supervised({ token = TOKEN, imageDir } = {}) {
  const sup = await startSupervisor({
    port: 0, host: '127.0.0.1', dataPath: walledData(), env: { ...ENV, ...(token == null ? {} : { WEAVE_DEPLOY_TOKEN: token }) },
    fetch: async () => new Response('not found', { status: 404 }), interval: 0, watchMs: 0,
    log: { log() {}, warn() {}, error() {} },
    onWorkerDied: () => { throw new Error('a worker died under the supervisor'); },
    ...(imageDir ? { imageDir } : {}),
  });
  const health = async (headers = {}, path = '/api/health') => {
    const r = await fetch(`http://127.0.0.1:${sup.port}${path}`, { headers });
    return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json() };
  };
  return { sup, health };
}

let shared = null;
const install = () => (shared ??= supervised());
test.after(async () => { if (shared) await (await shared).sup.close(); });

test('anonymous /api/health on a supervised install carries no supervisor block', async () => {
  const { health } = await install();
  for (const path of ['/api/health', '/api/health?probe=1']) {
    const { status, body } = await health({}, path);
    assert.equal(status, 200, path);
    assert.deepEqual(body, ANONYMOUS, `${path}: the supervisor adds nothing to the worker's anonymous body`);
  }
});

test('a request with the deploy token gets the supervisor block on the anonymous body', async () => {
  const { sup, health } = await install();
  const { status, cache, body } = await health({ [HEADER]: TOKEN });
  assert.equal(status, 200);
  assert.equal(cache, 'no-store', 'the token-bearing answer is never cached');
  const { supervisor, ...rest } = body;
  assert.deepEqual(rest, ANONYMOUS, 'the token unlocks the supervisor block and nothing from the worker');
  assert.equal(supervisor.release, 'image');
  assert.equal(supervisor.pid, sup.status().pid);
  assert.deepEqual(supervisor.failed, []);
  assert.ok(Date.parse(supervisor.since), 'the block names when the worker started serving');
});

test('a wrong deploy token gets the anonymous body', async () => {
  const { health } = await install();
  for (const given of ['x'.repeat(40), TOKEN.slice(1), `${TOKEN}k`, TOKEN.toUpperCase(), `Bearer ${TOKEN}`, '']) {
    const { status, body } = await health({ [HEADER]: given });
    assert.equal(status, 200, `${HEADER}: ${given.slice(0, 12)}`);
    assert.deepEqual(body, ANONYMOUS, `${HEADER} of ${given.length} characters unlocks nothing`);
  }
});

test('with no deploy token configured, or one under 32 characters, no request gets the block', async () => {
  for (const token of [null, 'k'.repeat(31)]) {
    const { sup, health } = await supervised({ token });
    try {
      for (const given of [TOKEN, 'k'.repeat(31)]) {
        const { body } = await health({ [HEADER]: given });
        assert.deepEqual(body, ANONYMOUS, `configured ${token?.length ?? 'none'}, sent ${given.length}`);
      }
    } finally { await sup.close(); }
  }
});

test('the deploy token header never reaches the worker', async () => {
  const { sup, health } = await supervised({ imageDir: echoingImage() });
  try {
    const right = await health({ [HEADER]: TOKEN });
    assert.equal(right.body.saw, null, 'the right token stops at the supervisor');
    assert.equal(right.body.supervisor.release, 'image');
    const wrong = await health({ [HEADER]: 'x'.repeat(40) }, '/api/workspace');
    assert.equal(wrong.body.saw, null, 'a wrong token on another path stops there too');
  } finally { await sup.close(); }
});
