import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { claimKey, matchesEcho, INBOUND_WINDOW_MS, ECHO_WINDOW_MS } = await import('../src/delivery.js');

const MINUTE = 60_000;
const T0 = Date.parse('2026-11-09T17:00:00Z');

function demo(path) {
  const dir = tempDir('weave-inbound-');
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  let clock = T0;
  w.now = () => new Date(clock);
  if (!w.findTable('Ops/Request')) {
    w.createSpace({ name: 'Ops' });
    const t = w.createTable({ space: 'Ops', name: 'Request' });
    w.addField(t.id, { name: 'Status', type: 'text' });
  }
  return { w, t: w.getTable('Ops/Request'), tick: (ms) => { clock += ms; } };
}

async function endpoint() {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { seen, port, url: `http://127.0.0.1:${port}/sync`, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

test('claimKey acknowledges a key seen within the window and forgets it after', () => {
  let seen = {};
  let out = claimKey(seen, 'evt_1', T0, INBOUND_WINDOW_MS);
  assert.equal(out.duplicate, false);
  seen = out.seen;
  out = claimKey(seen, 'evt_1', T0 + MINUTE, INBOUND_WINDOW_MS);
  assert.equal(out.duplicate, true);
  assert.equal(out.firstAt, T0);
  out = claimKey(out.seen, 'evt_1', T0 + INBOUND_WINDOW_MS + MINUTE, INBOUND_WINDOW_MS);
  assert.equal(out.duplicate, false, 'a key older than the window is new again');
  assert.deepEqual(Object.keys(out.seen), ['evt_1'], 'expired keys are pruned');
  assert.equal(INBOUND_WINDOW_MS, 24 * 60 * MINUTE);
});

test('claimInbound keeps one store per source in the workspace, so a restart still knows a delivery it ran', () => {
  const path = join(tempDir('weave-inbound-restart-'), 'ops.db');
  const first = demo(path);
  assert.deepEqual(first.w.claimInbound('stripe', 'evt_9'), { duplicate: false, key: 'evt_9', firstAt: new Date(T0).toISOString() });
  assert.equal(first.w.claimInbound('stripe', 'evt_9').duplicate, true);
  assert.equal(first.w.claimInbound('github', 'evt_9').duplicate, false, 'another source keeps its own keys');
  const again = demo(path);
  again.tick(MINUTE);
  assert.equal(again.w.claimInbound('stripe', 'evt_9').duplicate, true);
  again.tick(INBOUND_WINDOW_MS);
  assert.equal(again.w.claimInbound('stripe', 'evt_9').duplicate, false);
  assert.throws(() => again.w.claimInbound('stripe', ''), /delivery key/);
});

test('every write an automation makes carries an origin tag naming the rule; a person\'s write carries none', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Status', value: 'Seen' }, { type: 'add-comment', text: 'hi' }] });
  const e = w.createEntity(t.id, { Name: 'R1' });
  const entries = w.readEntity(e.id).activity;
  const byRule = entries.filter((a) => a.actor === `workflow:${auto.id}`);
  assert.ok(byRule.length >= 1);
  for (const a of byRule) assert.deepEqual(a.origin, { workflow: auto.id });
  const mine = entries.find((a) => a.kind === 'created');
  assert.equal(mine.origin, undefined);
});

test('matchesEcho answers whether a change repeats a write sent to that source within the window', () => {
  const writes = [{ source: 'hooks.example.com', record: 'r1', publicId: 4, values: { status: 'Done', name: 'R1' }, at: T0 }];
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', values: { status: 'Done' } }, T0 + MINUTE, ECHO_WINDOW_MS), true);
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', record: 'r1', values: { status: 'Done', name: 'R1' } }, T0, ECHO_WINDOW_MS), true);
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', record: 4, values: { status: 'Done' } }, T0, ECHO_WINDOW_MS), true, 'a public id names the record too');
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', values: { status: 'Open' } }, T0, ECHO_WINDOW_MS), false);
  assert.equal(matchesEcho(writes, { source: 'other.example.com', values: { status: 'Done' } }, T0, ECHO_WINDOW_MS), false);
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', record: 'r2', values: { status: 'Done' } }, T0, ECHO_WINDOW_MS), false);
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', values: {} }, T0, ECHO_WINDOW_MS), false, 'an empty change matches nothing');
  assert.equal(matchesEcho(writes, { source: 'hooks.example.com', values: { status: 'Done' } }, T0 + ECHO_WINDOW_MS + 1, ECHO_WINDOW_MS), false);
  assert.equal(ECHO_WINDOW_MS, 10 * MINUTE);
});

test('isEcho knows the http-request weave just sent: the same values back from that host are an echo, a real change is not', async () => {
  const api = await endpoint();
  try {
    const { w, t, tick } = demo();
    w.createAutomation(t.id, {
      name: 'Push', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', url: api.url, body: { name: '{{Name}}', status: 'Open' } }],
    });
    const e = w.createEntity(t.id, { Name: 'Echo me' });
    await w.automationsSettled();
    assert.equal(api.seen.length, 1);
    const source = `127.0.0.1:${api.port}`;
    assert.equal(w.isEcho(source, { values: { status: 'Open', name: 'Echo me' } }), true);
    assert.equal(w.isEcho(source, { record: e.id, values: { status: 'Open' } }), true);
    assert.equal(w.isEcho(source, { values: { status: 'Closed' } }), false);
    assert.equal(w.isEcho('elsewhere.example.com', { values: { status: 'Open' } }), false);
    tick(ECHO_WINDOW_MS + MINUTE);
    assert.equal(w.isEcho(source, { values: { status: 'Open' } }), false, 'the echo window has passed');
  } finally { await api.close(); }
});
