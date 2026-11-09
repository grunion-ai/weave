import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { retryable, retryDelayMs, DELIVERY_ATTEMPTS } = await import('../src/delivery.js');

const MINUTE = 60_000;
const SECRET = 'whsec-retry-never-stored-7788';

async function endpoint() {
  const seen = [];
  const plan = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const next = plan.length ? plan.shift() : 200;
    if (next === 'hang') return;
    res.writeHead(next, { 'Content-Type': 'application/json' });
    res.end(next < 300 ? '{"id":"remote-1"}' : '{"error":"down"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    seen, port, url: `http://127.0.0.1:${port}/hook`,
    fail: (...codes) => plan.push(...codes),
    close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

function workspace(dir = tempDir('weave-delivery-'), path = undefined) {
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  let clock = Date.parse('2026-11-09T14:00:00Z');
  w.now = () => new Date(clock);
  const tick = (ms) => { clock += ms; return w.now(); };
  return { w, dir, tick, at: () => clock };
}

function demo(opts) {
  const ctx = workspace(opts?.dir, opts?.path);
  const { w } = ctx;
  if (!w.findTable('Ops/Request')) {
    w.createSpace({ name: 'Ops' });
    const t = w.createTable({ space: 'Ops', name: 'Request' });
    w.addField(t.id, { name: 'Remote Id', type: 'text' });
  }
  return { ...ctx, t: w.getTable('Ops/Request') };
}

const fields = (w, id) => w.readEntity(id).fields;
const ran = (w, id) => w.readEntity(id).activity.filter((a) => a.kind === 'automation-ran');

test('a retryable failure is a network error, a timeout, 408, 429 or 5xx; never another 4xx or a refusal', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(retryable({ status }), true, String(status));
  for (const status of [400, 401, 403, 404, 409, 410, 422, 301, 302]) assert.equal(retryable({ status }), false, String(status));
  assert.equal(retryable({ network: true }), true);
  assert.equal(retryable({ refused: true }), false);
  assert.equal(retryable({}), false);
});

test('the backoff doubles from one minute and stops growing at an hour, over a fixed cap of attempts', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => retryDelayMs(n) / MINUTE), [1, 2, 4, 8, 16, 32, 60, 60]);
  assert.equal(DELIVERY_ATTEMPTS, 8);
});

test('a webhook answering 503 reads Warning with the attempt and the next try, holds the later steps, and a retry that lands returns it to Healthy', async () => {
  const hook = await endpoint();
  try {
    const { w, t, tick } = demo();
    const auto = w.createAutomation(t.id, {
      name: 'Notify', trigger: { type: 'entity-created' },
      actions: [{ type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'told the hook' }],
    });
    hook.fail(503);
    const e = w.createEntity(t.id, { Name: 'R1' });
    await w.automationsSettled();
    assert.equal(hook.seen.length, 1);
    assert.equal(fields(w, auto.id).Health, 'Warning');
    assert.equal(fields(w, auto.id)['Health Reason'], `POST 127.0.0.1:${hook.port}: HTTP 503; attempt 1 of 8 failed, next try 2026-11-09 14:01 UTC`);
    assert.equal(w.readEntity(e.id).comments.length, 0, 'the later step waits for the retried step');
    assert.equal(ran(w, e.id).length, 0, 'the run has not finished');

    tick(30_000);
    w.runDeliveries();
    await w.automationsSettled();
    assert.equal(hook.seen.length, 1, 'nothing is sent before the next try');

    tick(30_000);
    w.runSchedules();
    await w.automationsSettled();
    assert.equal(hook.seen.length, 2, 'the minute tick sends the retry');
    assert.equal(hook.seen[1].body, hook.seen[0].body, 'the retry sends the same body');
    assert.equal(fields(w, auto.id).Health, 'Healthy');
    assert.equal(fields(w, auto.id)['Health Reason'] ?? null, null);
    assert.deepEqual(w.readEntity(e.id).comments.map((c) => c.text), ['told the hook']);
    const [entry] = ran(w, e.id);
    assert.deepEqual(entry.detail.steps[0], { url: hook.url, sent: true });
    assert.equal(entry.detail.failed, undefined);
    assert.deepEqual(w.pendingDeliveries(), []);
  } finally { await hook.close(); }
});

test('an http-request is retried on 429, 5xx and a timeout, and fails at once on another 4xx or a refusal', async () => {
  const hook = await endpoint();
  try {
    const { w, t, tick } = demo();
    w.webhookTimeoutMs = 200;
    const auto = w.createAutomation(t.id, {
      name: 'Push', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', url: hook.url, body: { name: '{{Name}}' }, response: { 'Remote Id': 'id' } }],
    });
    hook.fail(429, 'hang', 502);
    const e = w.createEntity(t.id, { Name: 'Push me' });
    await w.automationsSettled();
    assert.match(fields(w, auto.id)['Health Reason'], /answered HTTP 429; attempt 1 of 8 failed, next try 2026-11-09 14:01 UTC$/);
    tick(MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    assert.match(fields(w, auto.id)['Health Reason'], /did not answer within 0\.2 s; attempt 2 of 8 failed, next try 2026-11-09 14:03 UTC$/);
    tick(2 * MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    assert.match(fields(w, auto.id)['Health Reason'], /answered HTTP 502; attempt 3 of 8 failed, next try 2026-11-09 14:07 UTC$/);
    tick(4 * MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    assert.equal(hook.seen.length, 4);
    assert.equal(fields(w, auto.id).Health, 'Healthy');
    assert.equal(fields(w, e.id)['Remote Id'], 'remote-1', 'the answer of the retry maps onto the record');

    hook.fail(404);
    w.createEntity(t.id, { Name: 'Gone' });
    await w.automationsSettled();
    assert.equal(fields(w, auto.id).Health, 'Failed');
    assert.match(fields(w, auto.id)['Health Reason'], /answered HTTP 404$/);
    assert.deepEqual(w.pendingDeliveries(), [], 'a 404 is not retried');

    delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
    try {
      w.createEntity(t.id, { Name: 'Guarded' });
      await w.automationsSettled();
    } finally { process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1'; }
    assert.match(fields(w, auto.id)['Health Reason'], /private or local address$/);
    assert.deepEqual(w.pendingDeliveries(), [], 'a refusal is not retried');
    assert.equal(hook.seen.length, 5);
  } finally { await hook.close(); }
});

test('a restart in the middle of a backoff loses nothing: the reopened workspace sends the retry and runs the later steps', async () => {
  const hook = await endpoint();
  const dir = tempDir('weave-delivery-restart-');
  const path = join(dir, 'ops.db');
  try {
    const first = demo({ dir, path });
    const auto = first.w.createAutomation(first.t.id, {
      name: 'Notify', trigger: { type: 'entity-created' },
      actions: [{ type: 'add-comment', text: 'before' }, { type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'after {{steps.1.text}}' }],
    });
    hook.fail(500);
    const e = first.w.createEntity(first.t.id, { Name: 'Survives' });
    await first.w.automationsSettled();
    assert.equal(fields(first.w, auto.id).Health, 'Warning');

    const again = demo({ dir, path });
    assert.equal(again.w.pendingDeliveries().length, 1, 'the waiting delivery was stored in the workspace');
    assert.equal(fields(again.w, auto.id).Health, 'Warning');
    again.tick(MINUTE);
    again.w.runSchedules();
    await again.w.automationsSettled();
    assert.equal(hook.seen.length, 2);
    assert.equal(fields(again.w, auto.id).Health, 'Healthy');
    assert.deepEqual(again.w.readEntity(e.id).comments.map((c) => c.text), ['before', 'after before']);
    assert.deepEqual(again.w.pendingDeliveries(), []);
  } finally { await hook.close(); }
});

test('after the cap the run stops, Health reads Failed with every attempt counted, and nothing is left waiting', async () => {
  const hook = await endpoint();
  try {
    const { w, t, tick } = demo();
    w.deliveryAttempts = 3;
    const auto = w.createAutomation(t.id, {
      name: 'Notify', trigger: { type: 'entity-created' },
      actions: [{ type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'never' }],
    });
    hook.fail(500, 500, 500);
    const e = w.createEntity(t.id, { Name: 'Doomed' });
    await w.automationsSettled();
    for (const wait of [1, 2]) {
      tick(wait * MINUTE);
      w.runDeliveries();
      await w.automationsSettled();
    }
    assert.equal(hook.seen.length, 3);
    assert.equal(fields(w, auto.id).Health, 'Failed');
    assert.equal(fields(w, auto.id)['Health Reason'], `POST 127.0.0.1:${hook.port}: HTTP 500; gave up after 3 attempts`);
    assert.equal(w.readEntity(e.id).comments.length, 0);
    assert.equal(ran(w, e.id)[0].detail.failed.step, 1);
    assert.deepEqual(w.pendingDeliveries(), []);
  } finally { await hook.close(); }
});

test('a signed webhook keeps one delivery id across its attempts, signs each with the clock of that attempt, and stores no credential', async () => {
  const hook = await endpoint();
  try {
    const { w, t, tick } = demo();
    w.setKey('hooks-receiver', SECRET);
    w.createAutomation(t.id, { name: 'Signed', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url, signWith: 'hooks-receiver' }] });
    hook.fail(503);
    w.createEntity(t.id, { Name: 'Signed row' });
    await w.automationsSettled();
    assert.equal(JSON.stringify(w.state).includes(SECRET), false, 'the waiting delivery holds the credential name alone');
    tick(MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    const [one, two] = hook.seen;
    assert.equal(one.headers['x-weave-delivery'], two.headers['x-weave-delivery']);
    assert.equal(one.headers['x-weave-timestamp'], String(Date.parse('2026-11-09T14:00:00Z') / 1000));
    assert.equal(two.headers['x-weave-timestamp'], String(Date.parse('2026-11-09T14:01:00Z') / 1000));
    assert.notEqual(one.headers['x-weave-signature'], two.headers['x-weave-signature']);
    assert.equal(JSON.stringify(w.state).includes(SECRET), false);
  } finally { await hook.close(); }
});

test('a newer run that succeeds while an older delivery waits keeps the row at Warning', async () => {
  const hook = await endpoint();
  try {
    const { w, t, tick } = demo();
    const auto = w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
    hook.fail(503);
    w.createEntity(t.id, { Name: 'First' });
    await w.automationsSettled();
    w.createEntity(t.id, { Name: 'Second' });
    await w.automationsSettled();
    assert.equal(fields(w, auto.id).Health, 'Warning');
    assert.match(fields(w, auto.id)['Health Reason'], /attempt 1 of 8 failed/);
    tick(MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    assert.equal(fields(w, auto.id).Health, 'Healthy');
  } finally { await hook.close(); }
});
