import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function withServer(fn) {
  const weave = new Weave();
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField('Sales/Deals', { name: 'Stage', type: 'text' });
  const row = weave.createEntity('Sales/Deals', { Name: 'Acme', Stage: 'Lead' });
  const { server, port } = await startServer(weave, { port: 0 });
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn({ call, weave, id: row.id }); } finally { server.close(); }
}

test('two sessions patch one field from the same revision: one wins, the other gets 412 with the winner\'s row', async () => {
  await withServer(async ({ call, id }) => {
    const [alice, bob] = await Promise.all([call('GET', `/entities/${id}`), call('GET', `/entities/${id}`)]);
    assert.equal(alice.body.revision, bob.body.revision);
    const answers = await Promise.all([
      call('PATCH', `/entities/${id}`, { values: { Stage: 'Won' } }, { 'If-Match': `"${alice.body.revision}"` }),
      call('PATCH', `/entities/${id}`, { values: { Stage: 'Lost' } }, { 'If-Match': `"${bob.body.revision}"` }),
    ]);
    const statuses = answers.map((a) => a.status).sort();
    assert.deepEqual(statuses, [200, 412], 'exactly one write lands');
    const won = answers.find((a) => a.status === 200);
    const refused = answers.find((a) => a.status === 412);
    assert.equal(refused.body.code, 'stale');
    assert.ok(refused.body.error);
    assert.equal(refused.body.entity.id, id);
    assert.equal(refused.body.entity.fields.Stage, won.body.fields.Stage, 'the refusal carries the winner\'s value');
    assert.equal(refused.body.entity.revision, won.body.revision, 'and the revision to retry from');
    const now = await call('GET', `/entities/${id}`);
    assert.equal(now.body.fields.Stage, won.body.fields.Stage);
  });
});

test('a 412 writes nothing: the row and its revision stay as the winner left them', async () => {
  await withServer(async ({ call, id }) => {
    const first = await call('GET', `/entities/${id}`);
    const moved = await call('PATCH', `/entities/${id}`, { values: { Stage: 'Won' } }, { 'If-Match': first.body.revision });
    assert.equal(moved.status, 200);
    assert.notEqual(moved.body.revision, first.body.revision, 'a write moves the revision');
    const stale = await call('PATCH', `/entities/${id}`, { values: { Stage: 'Lost', Name: 'Renamed' } }, { 'If-Match': first.body.revision });
    assert.equal(stale.status, 412);
    const after = await call('GET', `/entities/${id}`);
    assert.equal(after.body.fields.Stage, 'Won');
    assert.equal(after.body.name, 'Acme');
    assert.equal(after.body.revision, moved.body.revision);
    assert.equal(after.body.activity.length, moved.body.activity.length, 'no activity entry for the refused write');
  });
});

test('a PATCH without If-Match, or with If-Match: *, writes as before', async () => {
  await withServer(async ({ call, id }) => {
    const first = await call('GET', `/entities/${id}`);
    await call('PATCH', `/entities/${id}`, { values: { Stage: 'Won' } });
    const blind = await call('PATCH', `/entities/${id}`, { values: { Stage: 'Lost' } });
    assert.equal(blind.status, 200);
    assert.equal(blind.body.fields.Stage, 'Lost');
    const any = await call('PATCH', `/entities/${id}`, { Stage: 'Open' }, { 'If-Match': '*' });
    assert.equal(any.status, 200);
    assert.equal(any.body.fields.Stage, 'Open');
    assert.notEqual(any.body.revision, first.body.revision);
  });
});

test('a weak or quoted validator matches the bare revision', async () => {
  await withServer(async ({ call, id }) => {
    const first = await call('GET', `/entities/${id}`);
    const weak = await call('PATCH', `/entities/${id}`, { values: { Stage: 'Won' } }, { 'If-Match': `W/"${first.body.revision}"` });
    assert.equal(weak.status, 200);
  });
});

test('table query rows carry the revision a grid sends back as If-Match', async () => {
  await withServer(async ({ call, id }) => {
    const read = await call('GET', `/entities/${id}`);
    const grid = await call('POST', '/tables/Deals/query', { fields: ['Stage'], relations: 'chip' });
    assert.equal(grid.body.items[0].revision, read.body.revision);
    const ok = await call('PATCH', `/entities/${id}`, { values: { Stage: 'Won' } }, { 'If-Match': grid.body.items[0].revision });
    assert.equal(ok.status, 200);
  });
});
