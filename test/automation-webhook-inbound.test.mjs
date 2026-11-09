import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { withServer } = await import('./lib/fixtures.mjs');
const { handleMcpMessage } = await import('../src/mcp.js');
const { HOOK_BODY_MAX } = await import('../src/delivery.js');
const START = Date.parse('2026-11-09T12:00:00Z');

function workspace({ dir = tempDir('weave-hook-'), path } = {}) {
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  const clock = { t: START };
  w.now = () => new Date(clock.t);
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  for (const name of ['Remote Id', 'Status']) w.addField(task.id, { name, type: 'text' });
  return { w, task, clock, dir };
}

const intake = (extra = {}, actions = null) => ({
  name: 'Intake',
  trigger: { type: 'webhook-inbound', key: 'id', ...extra },
  actions: actions ?? [{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields: { 'Remote Id': 'trigger.body.id', Name: 'trigger.body.title', Status: 'trigger.body.status' } }],
});

const sign = (secret, ts, body) => `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
const rows = (w, task) => w.listEntities(task.id).map((e) => w.readEntity(e.id).fields);
const wf = (w, id) => w.readEntity(id).fields;

async function post(base, path, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function reveal(base, id, body = {}) {
  const res = await fetch(`${base}/api/automations/${id}/secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

function signed(w, secret, body, { delivery, ts } = {}) {
  const text = JSON.stringify(body);
  const stamp = String(ts ?? Math.floor(w.now().getTime() / 1000));
  return [text, { 'X-Weave-Timestamp': stamp, 'X-Weave-Signature': sign(secret, stamp, text), ...(delivery ? { 'X-Weave-Delivery': delivery } : {}) }];
}

test('a webhook-inbound rule mints its endpoint on save, reads in words and reveals its secret once', async () => {
  const { w, task } = workspace();
  const auto = w.createAutomation(task.id, intake());
  const f = wf(w, auto.id);
  assert.equal(f.State, 'Ready');
  assert.match(auto.hook.path, new RegExp(`^/w/${w.state.meta.name}/api/hooks/[0-9a-f]{32}$`));
  assert.equal(f.When, `A POST arrives at ${auto.hook.path}`);
  assert.equal(f.Then, 'Create or update a record in Ops/Task by Remote Id');
  const [d] = w.describeAutomations(task.id);
  assert.equal(d.trigger.type, 'webhook-inbound');
  assert.equal(d.trigger.key, 'id');
  assert.equal(d.hook.path, auto.hook.path);
  assert.equal(d.hook.revealed, false);
  assert.throws(() => w.createAutomation(task.id, intake({}, [{ type: 'set-field', field: 'Status', value: 'x' }])), /names the record by a path, as record/);
  assert.throws(() => w.createAutomation(task.id, intake({}, [{ type: 'http-request', url: 'https://example.com/x', response: { Status: 'status' } }])), /no response map/);
  assert.throws(() => w.createAutomation(task.id, intake({ items: 3 })), /items/);
  await withServer(w, async ({ base }) => {
    const first = await reveal(base, auto.id);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.match(first.json.secret, /^whsec_[A-Za-z0-9_-]{32,}$/);
    assert.equal(new URL(first.json.url).pathname, `/api/hooks/${auto.hook.path.split('/').at(-1)}`);
    assert.equal(new URL(first.json.url).port, new URL(base).port);
    const again = await reveal(base, auto.id);
    assert.equal(again.status, 409);
    assert.match(again.json.error, /shown once/);
    const rotated = await reveal(base, auto.id, { rotate: true });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.json.secret, first.json.secret);
  });
  const mcp = await handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_automations', arguments: { action: 'secret', automation: auto.id } } });
  assert.equal(mcp.result.isError, true);
  assert.match(mcp.result.content[0].text, /not an agent action/);
});

test('a POST to the minted URL is admitted only signed and fresh, or with the secret header, and every delivery is logged on the rule', async () => {
  const dir = tempDir('weave-hook-');
  const { w, task, clock } = workspace({ dir, path: join(dir, 'ops.db') });
  const auto = w.createAutomation(task.id, intake());
  const path = `/api/hooks/${auto.hook.path.split('/').at(-1)}`;
  await withServer(w, async ({ base }) => {
    const { secret } = (await reveal(base, auto.id)).json;
    const [goodText, goodHeaders] = signed(w, secret, { id: 'gh-1', title: 'From GitHub', status: 'open' }, { delivery: 'd-1' });
    const ok = await post(base, path, goodText, goodHeaders);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.ran, 1);
    await w.automationsSettled();
    assert.deepEqual(rows(w, task).map((r) => [r.Name, r['Remote Id'], r.Status]), [['From GitHub', 'gh-1', 'open']]);
    assert.equal(wf(w, auto.id).Health, 'Healthy');
    assert.ok(wf(w, auto.id)['Last Run']);

    const replay = await post(base, path, goodText, goodHeaders);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.duplicate, true);
    w.updateEntity(w.listEntities(task.id)[0].id, { Status: 'edited' });
    await w.automationsSettled();
    assert.equal(rows(w, task)[0].Status, 'edited', 'a redelivery is acknowledged and not run again');

    const [badText, badHeaders] = signed(w, 'whsec_not-the-secret-value-0000000000', { id: 'gh-2', title: 'Forged' });
    const forged = await post(base, path, badText, badHeaders);
    assert.equal(forged.status, 401);
    assert.match(forged.json.error, /signature/);

    const [staleText, staleHeaders] = signed(w, secret, { id: 'gh-3', title: 'Stale' }, { ts: Math.floor(START / 1000) - 600 });
    const stale = await post(base, path, staleText, staleHeaders);
    assert.equal(stale.status, 401);
    assert.match(stale.json.error, /timestamp/);

    const bare = await post(base, path, { id: 'gh-4', title: 'Unsigned' });
    assert.equal(bare.status, 401);

    const wrongHeader = await post(base, path, { id: 'gh-5', title: 'Wrong' }, { 'X-Weave-Secret': 'whsec_wrong-value-00000000000000000000' });
    assert.equal(wrongHeader.status, 401);

    const header = await post(base, path, { id: 'gh-6', title: 'By header', status: 'new' }, { 'X-Weave-Secret': secret });
    assert.equal(header.status, 200, JSON.stringify(header.json));
    await w.automationsSettled();

    const big = await post(base, path, JSON.stringify({ id: 'gh-7', title: 'x'.repeat(HOOK_BODY_MAX) }), { 'X-Weave-Secret': secret });
    assert.equal(big.status, 413);

    const elsewhere = await post(base, '/api/hooks/0123456789abcdef0123456789abcdef', { id: 'gh-8' }, { 'X-Weave-Secret': secret });
    assert.equal(elsewhere.status, 404);

    assert.deepEqual(rows(w, task).map((r) => r['Remote Id']).sort(), ['gh-1', 'gh-6']);
    const log = w.hookDeliveries(auto.id);
    assert.deepEqual(log.map((x) => x.status), [413, 200, 401, 401, 401, 401, 200, 200]);
    assert.deepEqual(log.map((x) => x.outcome), ['refused', 'ran', 'refused', 'refused', 'refused', 'refused', 'duplicate', 'ran']);
    assert.match(log[0].reason, /bytes/);
    assert.match(log[4].reason, /timestamp/);
    assert.match(log[5].reason, /signature/);
    assert.ok(log.every((x) => x.at && Number.isInteger(x.size)));
    assert.match(wf(w, auto.id)['Health Reason'], /Last delivery .* refused: body over/);

    clock.t += 60_000;
    w.save();
    const everything = [readFileSync(join(dir, 'ops.db')).toString('latin1'),
      ...readdirSync(dir).filter((n) => n.startsWith('ops.db')).map((n) => readFileSync(join(dir, n)).toString('latin1')),
      JSON.stringify(w.state), JSON.stringify(w.listAudit({ limit: 100000 })), JSON.stringify(w.describeAutomations()),
      JSON.stringify(w.listAutomations()), JSON.stringify(log), JSON.stringify(w.listKeys())].join('\n');
    assert.ok(!everything.includes(secret), 'the secret appears nowhere in state, logs, step outputs or the key list');
    assert.ok(!everything.includes(secret.slice(6)), 'nor does its body');
  });
});

test('a rule that is Off answers 202 and runs nothing; an echo of what weave sent is dropped', async () => {
  const seen = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const source = `127.0.0.1:${api.address().port}`;
  try {
    const { w, task } = workspace();
    const off = w.createAutomation(task.id, { ...intake(), enabled: false });
    const sync = w.createAutomation(task.id, {
      name: 'Sync', trigger: { type: 'webhook-inbound', from: source, record: 'record' },
      actions: [{ type: 'set-field', field: 'Status', value: '{{trigger.body.status}}' }, { type: 'add-comment', text: 'Heard {{trigger.body.status}}' }],
    });
    const push = w.createAutomation(task.id, { name: 'Push', trigger: { type: 'entity-created' }, actions: [{ type: 'http-request', method: 'POST', url: `http://${source}/sync`, body: { record: '{{PublicId}}', status: 'Open' } }] });
    assert.ok(push.id);
    const e = w.createEntity(task.id, { Name: 'Shared' });
    await w.automationsSettled();
    assert.equal(seen.length, 1);
    await withServer(w, async ({ base }) => {
      const offSecret = (await reveal(base, off.id)).json.secret;
      const offPath = `/api/hooks/${off.hook.path.split('/').at(-1)}`;
      const quiet = await post(base, offPath, { id: 'gh-9', title: 'Off' }, { 'X-Weave-Secret': offSecret });
      assert.equal(quiet.status, 202);
      assert.equal(quiet.json.ran, 0);
      assert.equal(rows(w, task).filter((r) => r['Remote Id'] === 'gh-9').length, 0);
      assert.equal(w.hookDeliveries(off.id)[0].outcome, 'off');
      assert.equal(wf(w, off.id)['Last Run'], null);

      const syncSecret = (await reveal(base, sync.id)).json.secret;
      const syncPath = `/api/hooks/${sync.hook.path.split('/').at(-1)}`;
      const echo = await post(base, syncPath, { record: String(e.publicId), status: 'Open' }, { 'X-Weave-Secret': syncSecret });
      assert.equal(echo.status, 200);
      assert.equal(echo.json.echoes, 1);
      assert.equal(echo.json.ran, 0);
      const real = await post(base, syncPath, { record: String(e.publicId), status: 'Closed' }, { 'X-Weave-Secret': syncSecret });
      assert.equal(real.status, 200, JSON.stringify(real.json));
      assert.equal(real.json.ran, 1);
      await w.automationsSettled();
      const after = w.readEntity(e.id);
      assert.equal(after.fields.Status, 'Closed');
      assert.equal(after.comments.at(-1).text, 'Heard Closed');
      const missing = await post(base, syncPath, { record: '999', status: 'Closed' }, { 'X-Weave-Secret': syncSecret });
      assert.equal(missing.status, 422);
      assert.match(missing.json.error, /No record '999'/);
      assert.deepEqual(w.hookDeliveries(sync.id).map((x) => x.outcome), ['failed', 'ran', 'echo']);
    });
  } finally {
    api.closeAllConnections();
    await new Promise((r) => api.close(r));
  }
});

test('items fires the rule once per item of the list in the body, with trigger.item', async () => {
  const { w, task } = workspace();
  const auto = w.createAutomation(task.id, intake({ key: 'delivery', items: 'data' }, [{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields: { 'Remote Id': 'trigger.item.id', Name: 'trigger.item.title', Status: 'trigger.body.source' } }]));
  await withServer(w, async ({ base }) => {
    const { secret } = (await reveal(base, auto.id)).json;
    const path = `/api/hooks/${auto.hook.path.split('/').at(-1)}`;
    const [text, headers] = signed(w, secret, { delivery: 'evt_1', source: 'stripe', data: [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }] });
    const res = await post(base, path, text, headers);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.ran, 2);
    await w.automationsSettled();
    assert.deepEqual(rows(w, task).map((r) => [r['Remote Id'], r.Name, r.Status]).sort(), [['p1', 'One', 'stripe'], ['p2', 'Two', 'stripe']]);
    const [noList, noListHeaders] = signed(w, secret, { delivery: 'evt_2', data: 'none' });
    const refused = await post(base, path, noList, noListHeaders);
    assert.equal(refused.status, 422);
    assert.match(refused.json.error, /items path 'data'/);
  });
});
