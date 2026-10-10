import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Weave, WeaveError } from '../src/engine.js';
import { CFStore } from '../src/store-cf.js';
import { createForm } from '../src/forms.js';
import { statusFor } from '../src/routes.js';
import { WeaveWorkspace } from '../src/worker.js';

function shimStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    sql: {
      exec(query, ...params) {
        if (params.length === 0 && !/^\s*SELECT/i.test(query)) {
          db.exec(query);
          return { toArray: () => [] };
        }
        const stmt = db.prepare(query);
        if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) };
        stmt.run(...params);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
}

function makeDO(storage, env = {}) {
  return new WeaveWorkspace({ storage }, { WEAVE_VERSION: '0.0.0-test', ...env });
}

async function call(dobj, method, path, body) {
  const req = new Request(`http://do${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-weave-workspace': 'scratch' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await dobj.fetch(req);
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}

test('worker DO: health, CRUD, and undo over the same dispatcher node uses', async () => {
  const storage = shimStorage();
  const dobj = makeDO(storage);

  const health = await call(dobj, 'GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.version, '0.0.0-test');
  assert.equal(health.data.workspace, 'scratch');

  assert.equal((await call(dobj, 'POST', '/api/spaces', { name: 'S' })).status, 201);
  assert.equal((await call(dobj, 'POST', '/api/tables', { space: 'S', name: 'T' })).status, 201);
  await call(dobj, 'POST', '/api/tables/T/fields', { name: 'N', type: 'number' });
  const made = await call(dobj, 'POST', '/api/tables/T/entities', { name: 'row', values: { N: 1 } });
  assert.equal(made.status, 201);

  await call(dobj, 'PATCH', `/api/entities/${made.data.id}`, { values: { N: 9 } });
  const undone = await call(dobj, 'POST', '/api/undo', { steps: 1 });
  assert.equal(undone.status, 200);
  assert.equal(undone.data.undone.length, 1);
  const read = await call(dobj, 'GET', `/api/entities/${made.data.id}`);
  assert.equal(read.data.fields.N, 1);
});

test('worker DO: an encoded qualified table name queries like the bare name', async () => {
  const dobj = makeDO(shimStorage());
  await call(dobj, 'POST', '/api/spaces', { name: 'S' });
  await call(dobj, 'POST', '/api/tables', { space: 'S', name: 'T' });
  await call(dobj, 'POST', '/api/tables/T/entities', { name: 'row' });
  const res = await call(dobj, 'POST', '/api/tables/S%2FT/query', {});
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 1);
  assert.equal((await call(dobj, 'POST', '/api/tables/S%2FNope/query', {})).data.code, 'not-found');
});

test('worker DO: state persists across DO restarts (same storage, fresh instance)', async () => {
  const storage = shimStorage();
  const first = makeDO(storage);
  const made = await (async () => {
    await call(first, 'POST', '/api/spaces', { name: 'S' });
    await call(first, 'POST', '/api/tables', { space: 'S', name: 'T' });
    return call(first, 'POST', '/api/tables/T/entities', { name: 'durable row' });
  })();

  const second = makeDO(storage);
  const read = await call(second, 'GET', `/api/entities/${made.data.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.data.name, 'durable row');
});

test('worker DO: v1 limits are spoken, not silent', async () => {
  const storage = shimStorage();
  const dobj = makeDO(storage);
  const refused = await call(dobj, 'POST', '/api/workspaces', { name: 'other' });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /not yet available on the hosted instance/);
});

test('worker DO: workspace scoping serves /w/<own name>/ and 404s strangers', async () => {
  const storage = shimStorage();
  const dobj = makeDO(storage);
  await call(dobj, 'GET', '/api/health');
  const own = await call(dobj, 'GET', '/w/scratch/api/health');
  assert.equal(own.status, 200);
  const stranger = await call(dobj, 'GET', '/w/nope/api/health');
  assert.equal(stranger.status, 404);
});


test('worker forms accept URLencoded submissions, preserve retries and enforce transport boundaries', async () => {
  const storage = shimStorage();
  const w = new Weave({ store: new CFStore(storage), name: 'scratch' });
  w.createSpace({ name: 'Intake' });
  w.createTable({ space: 'Intake', name: 'Requests' });
  const form = createForm(w, { name: 'Requests', table: 'Intake/Requests', fields: ['Name'] });
  const dobj = makeDO(storage);
  const send = (path, body, headers = {}) => dobj.fetch(new Request(`http://do${path}`, { method: 'POST', headers: { 'x-weave-workspace': 'scratch', ...headers }, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }));
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://do', 'Idempotency-Key': crypto.randomUUID() };
  const first = await send(`/f/${form.id}`, 'Name=Worker', headers);
  assert.equal(first.status, 201);
  const retry = await send(`/api/forms/${form.id}/submit`, 'Name=Worker', headers);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, (await first.json()).id);
  assert.equal((await send(`/f/${form.id}`, 'Name=Other', { ...headers, Origin: 'http://evil' })).status, 403);
  assert.equal((await send('/api/tables/Requests/entities', 'Name=Other', headers)).status, 400);
  const huge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('Name=' + 'x'.repeat(65536))); controller.close(); } });
  assert.equal((await send(`/f/${form.id}`, huge, headers)).status, 413);
});

test('receipt capacity errors map to HTTP 429', () => {
  assert.equal(statusFor(new WeaveError('Capacity reached', 'rate-limited')), 429);
});
