import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './lib/temp.mjs';
import { withServer, unwrapData } from './lib/fixtures.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { handleMcpMessage } = await import('../src/mcp.js');

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const MINUTE = 60_000;
const SECRET = 'whsec-dead-letter-never-stored-5151';
const API_KEY = 'sk-dead-letter-integration-6262';
const HOST = 'api.example.com';

async function endpoint() {
  const seen = [];
  const plan = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const next = plan.length ? plan.shift() : 200;
    res.writeHead(next, { 'Content-Type': 'application/json' });
    res.end(next < 300 ? '{"id":"remote-9"}' : '{"error":"down"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && u.hostname === HOST) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
    return real(u, init);
  };
  return {
    seen, port, url: `http://127.0.0.1:${port}/hook`,
    fail: (...codes) => plan.push(...codes),
    close: () => { globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

function demo({ path } = {}) {
  const dir = tempDir('weave-dead-letter-');
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  let clock = Date.parse('2026-11-09T15:00:00Z');
  w.now = () => new Date(clock);
  w.deliveryAttempts = 2;
  if (!w.findTable('Ops/Request')) {
    w.createSpace({ name: 'Ops' });
    w.createTable({ space: 'Ops', name: 'Request' });
  }
  const t = w.getTable('Ops/Request');
  const exhaust = async () => {
    await w.automationsSettled();
    clock += MINUTE;
    w.runDeliveries();
    await w.automationsSettled();
  };
  return { w, t, dir, exhaust, tick: (ms) => { clock += ms; } };
}

const fields = (w, id) => w.readEntity(id).fields;
const letters = (w) => w.listEntities(w.getTable('System/Failed Deliveries').id);

test('System/Failed Deliveries is a built-in table beside Workflows, with its columns and states', () => {
  const { w } = demo();
  const t = w.getTable('System/Failed Deliveries');
  assert.equal(t.system, 'deliveries');
  const byName = Object.fromEntries(Object.values(t.fields).map((f) => [f.name, f]));
  for (const n of ['Name', 'Status', 'Workflow', 'Record', 'Request', 'Attempts', 'Last Error', 'Last Attempt']) assert.ok(byName[n], `${n} is a column`);
  assert.deepEqual(byName.Status.config.options.map((o) => [o.name, o.hue]), [['Failed', 'red'], ['Replay', 'blue'], ['Delivered', 'green']]);
  assert.equal(byName.Workflow.type, 'relation');
  assert.equal(byName.Request.type, 'document');
});

test('a delivery past the cap becomes a Failed Deliveries record with the rule, the firing record, the request, each attempt and the last error, and no credential anywhere', async () => {
  const hook = await endpoint();
  try {
    const { w, t, exhaust } = demo();
    w.setKey('hooks-receiver', SECRET);
    const ints = w.getTable('System/Integrations');
    const integration = w.createEntity(ints.id, { name: 'Acme API', values: { Provider: 'Generic API key', Host: HOST } });
    hook.fail(200);
    await w.setIntegrationCredential(integration.id, API_KEY);
    hook.seen.length = 0;
    const hookRule = w.createAutomation(t.id, { name: 'Tell the hook', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url, signWith: 'hooks-receiver' }] });
    const apiRule = w.createAutomation(t.id, {
      name: 'Tell the API', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', integration: 'Acme API', url: `https://${HOST}/v1/items`, body: { name: '{{Name}}' } }],
    });
    hook.fail(503, 500, 502, 504);
    const e = w.createEntity(t.id, { Name: 'Lost' });
    await exhaust();
    assert.equal(hook.seen.length, 4);
    for (const rule of [hookRule, apiRule]) {
      assert.equal(fields(w, rule.id).Health, 'Failed');
      assert.match(fields(w, rule.id)['Health Reason'], /HTTP 50\d; gave up after 2 attempts$/);
    }
    const byRule = Object.fromEntries(letters(w).map((x) => w.readEntity(x.id)).map((x) => [x.fields.Workflow.name, x]));
    const hookLetter = byRule['Tell the hook'];
    const apiLetter = byRule['Tell the API'];
    assert.equal(hookLetter.fields.Status, 'Failed');
    assert.equal(hookLetter.name, `POST 127.0.0.1:${hook.port}/hook`);
    assert.equal(hookLetter.fields.Record, `Ops/Request #${e.publicId} Lost`);
    assert.match(hookLetter.fields['Last Error'], new RegExp(`^POST 127\\.0\\.0\\.1:${hook.port}: HTTP 50\\d$`));
    assert.equal(hookLetter.fields['Last Attempt'], 'Nov 9, 2026 3:01 PM');
    assert.match(hookLetter.docs.Attempts, /^2026-11-09 15:00 UTC  POST 127\.0\.0\.1:\d+: HTTP 50\d\n2026-11-09 15:01 UTC  POST 127\.0\.0\.1:\d+: HTTP 50\d$/);
    const request = JSON.parse(hookLetter.docs.Request);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, hook.url);
    assert.equal(request.signWith, 'hooks-receiver');
    assert.equal(JSON.parse(request.body).automation, 'Tell the hook');
    assert.equal(apiLetter.name, `POST ${HOST}/v1/items`);
    assert.equal(JSON.parse(apiLetter.docs.Request).integration, 'Acme API');
    assert.deepEqual(JSON.parse(JSON.parse(apiLetter.docs.Request).body), { name: 'Lost' });

    const everywhere = JSON.stringify([w.state, w.listAudit({ limit: 500 }), w.exportJSON?.(), w.readEntity(e.id)]);
    assert.equal(everywhere.includes(SECRET), false, 'the signing credential is in no record, run log or audit entry');
    assert.equal(everywhere.includes(API_KEY), false, 'the integration key is in no record, run log or audit entry');
  } finally { await hook.close(); }
});

test('replaying a Failed Deliveries record sends it again, resumes the later steps and reads Delivered and Healthy', async () => {
  const hook = await endpoint();
  try {
    const { w, t, exhaust } = demo();
    const auto = w.createAutomation(t.id, {
      name: 'Notify', trigger: { type: 'entity-created' },
      actions: [{ type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'delivered at last' }],
    });
    hook.fail(500, 500);
    const e = w.createEntity(t.id, { Name: 'Late' });
    await exhaust();
    const [letter] = letters(w);
    assert.equal(fields(w, letter.id).Status, 'Failed');

    const out = w.replayDelivery(letter.id);
    assert.equal(out.status, 'Replay');
    await w.automationsSettled();
    assert.equal(hook.seen.length, 3);
    assert.equal(hook.seen[2].body, hook.seen[0].body, 'the replay sends the stored request');
    assert.equal(fields(w, letter.id).Status, 'Delivered');
    assert.equal(fields(w, auto.id).Health, 'Healthy');
    assert.deepEqual(w.readEntity(e.id).comments.map((c) => c.text), ['delivered at last']);
    assert.throws(() => w.replayDelivery(letter.id), /already delivered/);
  } finally { await hook.close(); }
});

test('a replay that fails again retries with Warning and, past the cap, returns the same record to Failed with every attempt', async () => {
  const hook = await endpoint();
  try {
    const { w, t, exhaust } = demo();
    const auto = w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
    hook.fail(500, 500, 503, 503);
    w.createEntity(t.id, { Name: 'Stubborn' });
    await exhaust();
    const [letter] = letters(w);
    w.replayDelivery(letter.id);
    await w.automationsSettled();
    assert.equal(fields(w, auto.id).Health, 'Warning');
    assert.equal(fields(w, letter.id).Status, 'Replay');
    await exhaust();
    assert.equal(letters(w).length, 1, 'the replay does not make a second record');
    assert.equal(fields(w, letter.id).Status, 'Failed');
    assert.equal((w.readEntity(letter.id).docs.Attempts.match(/UTC/g) ?? []).length, 4);
    assert.equal(fields(w, auto.id).Health, 'Failed');
  } finally { await hook.close(); }
});

test('setting Status to Replay in the grid replays the record, as the app does', async () => {
  const hook = await endpoint();
  try {
    const { w, t, exhaust } = demo();
    w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
    hook.fail(500, 500);
    w.createEntity(t.id, { Name: 'From the grid' });
    await exhaust();
    const [letter] = letters(w);
    w.updateEntity(letter.id, { Status: 'Replay' });
    await w.automationsSettled();
    assert.equal(hook.seen.length, 3);
    assert.equal(fields(w, letter.id).Status, 'Delivered');
    assert.throws(() => w.updateEntity(letter.id, { Status: 'Delivered' }), /weave sets/);
  } finally { await hook.close(); }
});

test('the replay is one registry command, reached from MCP, HTTP and the CLI', async () => {
  const hook = await endpoint();
  try {
    const one = async () => {
      const ctx = demo();
      ctx.w.createAutomation(ctx.t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
      hook.fail(500, 500);
      ctx.w.createEntity(ctx.t.id, { Name: 'Door' });
      await ctx.exhaust();
      return { ...ctx, letter: letters(ctx.w)[0] };
    };

    const viaMcp = await one();
    const res = handleMcpMessage(viaMcp.w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_automations', arguments: { action: 'replay', delivery: viaMcp.letter.id } } }, { tools: 'all' });
    assert.ok(!res.result.isError, res.result.content[0].text);
    assert.equal(JSON.parse(unwrapData(res.result.content[0].text)).status, 'Replay');
    await viaMcp.w.automationsSettled();
    assert.equal(fields(viaMcp.w, viaMcp.letter.id).Status, 'Delivered');

    const viaHttp = await one();
    await withServer(viaHttp.w, async ({ fetch }) => {
      const r = await fetch(`/api/automations/deliveries/${viaHttp.letter.id}/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).status, 'Replay');
      await viaHttp.w.automationsSettled();
    });
    assert.equal(fields(viaHttp.w, viaHttp.letter.id).Status, 'Delivered');

    const dir = tempDir('weave-dead-letter-cli-');
    const data = join(dir, 'ops.db');
    const viaCli = demo({ path: data });
    viaCli.w.createAutomation(viaCli.t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
    hook.fail(500, 500);
    viaCli.w.createEntity(viaCli.t.id, { Name: 'Door' });
    await viaCli.exhaust();
    const [letter] = letters(viaCli.w);
    const sent = hook.seen.length;
    const r = await promisify(execFile)(process.execPath, ['--no-warnings', BIN, 'automation', 'replay', letter.id, '--data', data], {
      encoding: 'utf8', env: { ...process.env, WEAVE_KEYSTORE: join(dir, 'keystore.json'), WEAVE_WEBHOOK_ALLOW_PRIVATE: '1' },
    });
    assert.equal(JSON.parse(r.stdout).status, 'Replay');
    assert.equal(hook.seen.length, sent + 1, 'the CLI sent the replay before it exited');
    const reread = new Weave({ path: data, keystorePath: join(dir, 'keystore.json') });
    assert.equal(fields(reread, letter.id).Status, 'Delivered');
  } finally { await hook.close(); }
});
