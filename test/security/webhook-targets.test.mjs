import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { read } from '../lib/source.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'weave-sec-webhook-'));
process.env.WEAVE_KEYSTORE = join(ROOT, 'keystore.json');
delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
const { Weave, localAddress } = await import('../../src/engine.js');
const { GUIDES } = await import('../../src/handbook.js');

test.after(() => rmSync(ROOT, { recursive: true, force: true }));

function demo() {
  const w = new Weave({ keystorePath: process.env.WEAVE_KEYSTORE });
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Request' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done', category: 'done' }] } });
  return { w, t };
}

async function hook(handler) {
  const hits = [];
  const server = createServer((req, res) => { hits.push(req.url); handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, hits, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

async function until(fn) {
  const deadline = Date.now() + 5000;
  while (!fn() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return fn();
}

function fire(w, t, url) {
  const auto = w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'state-changed', field: 'Status', toState: 'Done' }, actions: [{ type: 'webhook', url }] });
  const row = w.createEntity(t.id, { Name: 'R1' });
  w.setState(row.id, 'Status', 'Done');
  return auto;
}

const health = (w, id) => w.readEntity(id).fields;

test('the private and local ranges are refused as webhook targets; public addresses are not', () => {
  const refused = ['127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.9', '169.254.169.254', '100.100.100.200', '0.0.0.0', '::1', '::', 'fe80::1', 'fd12::1', 'fdaa::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1'];
  for (const ip of refused) assert.equal(localAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2001:db8::1', '2606:4700::1111']) assert.equal(localAddress(ip), false, ip);
  assert.equal(localAddress('example.com'), false, 'a name is not an address');
});

test('a webhook to a loopback literal is refused before any connection and the row says why (Issue #500)', async () => {
  const { close, hits, port } = await hook((req, res) => { req.resume(); res.end(); });
  try {
    const { w, t } = demo();
    const auto = fire(w, t, `http://127.0.0.1:${port}/hook`);
    assert.ok(await until(() => health(w, auto.id).Health === 'Failed'));
    assert.equal(health(w, auto.id)['Health Reason'], `POST 127.0.0.1:${port}: refused, 127.0.0.1 is a private or local address`);
    assert.deepEqual(hits, [], 'nothing reached the server');
  } finally { await close(); }
});

test('a webhook whose host resolves to a loopback address is refused after the lookup (Issue #500)', async () => {
  const { close, hits, port } = await hook((req, res) => { req.resume(); res.end(); });
  try {
    const { w, t } = demo();
    const auto = fire(w, t, `http://localhost:${port}/hook`);
    assert.ok(await until(() => health(w, auto.id).Health === 'Failed'));
    assert.match(health(w, auto.id)['Health Reason'], new RegExp(`^POST localhost:${port}: refused, localhost resolves to (127\\.0\\.0\\.1|::1), a private or local address$`));
    assert.deepEqual(hits, []);
  } finally { await close(); }
});

test('a decimal, hex or mapped spelling of a loopback address is refused too (Issue #500)', async () => {
  const { w, t } = demo();
  const a = fire(w, t, 'http://2130706433:9/hook');
  const b = fire(w, t, 'http://0x7f000001:9/hook');
  const c = fire(w, t, 'http://[::ffff:127.0.0.1]:9/hook');
  assert.ok(await until(() => [a, b, c].every((x) => health(w, x.id).Health === 'Failed')));
  for (const x of [a, b, c]) assert.match(health(w, x.id)['Health Reason'], /refused, .* is a private or local address$/);
});

test('with WEAVE_WEBHOOK_ALLOW_PRIVATE=1 a loopback webhook is delivered and the row reads Healthy (Issue #500)', async () => {
  const { close, hits, port } = await hook((req, res) => { req.resume(); res.end(); });
  process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
  try {
    const { w, t } = demo();
    const auto = fire(w, t, `http://127.0.0.1:${port}/hook`);
    assert.ok(await until(() => hits.length === 1));
    assert.ok(await until(() => health(w, auto.id).Health === 'Healthy'));
  } finally { delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE; await close(); }
});

test('a webhook never follows a redirect: a 3xx is a failed delivery and the target is not fetched (Issue #500)', async () => {
  const target = await hook((req, res) => { req.resume(); res.end(); });
  const first = await hook((req, res) => { req.resume(); res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/elsewhere` }); res.end(); });
  process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
  try {
    const { w, t } = demo();
    const auto = fire(w, t, `http://127.0.0.1:${first.port}/hook`);
    assert.ok(await until(() => health(w, auto.id).Health === 'Failed'));
    assert.equal(health(w, auto.id)['Health Reason'], `POST 127.0.0.1:${first.port}: HTTP 302`);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(first.hits, ['/hook']);
    assert.deepEqual(target.hits, [], 'the redirect target was never fetched');
  } finally { delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE; await first.close(); await target.close(); }
});

test('WEAVE_WEBHOOK_ALLOW_PRIVATE is named in the CLI help, the Handbook environment reference, the Dockerfile and compose.yaml', () => {
  const guide = GUIDES.find((g) => g.name === 'Environment reference');
  assert.match(read('bin/weave.js'), /WEAVE_WEBHOOK_ALLOW_PRIVATE/);
  assert.match(guide.doc, /\| `WEAVE_WEBHOOK_ALLOW_PRIVATE` \|/);
  assert.match(read('Dockerfile'), /WEAVE_WEBHOOK_ALLOW_PRIVATE/);
  assert.match(read('compose.yaml'), /WEAVE_WEBHOOK_ALLOW_PRIVATE/);
});
