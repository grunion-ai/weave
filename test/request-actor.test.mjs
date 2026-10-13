import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { startServer } from '../src/server.js';

async function waitFor(check, what) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await setImmediate();
  assert.ok(check(), what);
}

async function fixture(t, options = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Intake' });
  w.createTable({ space: 'Intake', name: 'Requests' });
  const alice = w.createAccount({ name: 'alice', role: 'editor' }).token;
  const bob = w.createAccount({ name: 'bob', role: 'editor' }).token;
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, ...options });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { w, alice, bob, base: `http://127.0.0.1:${server.address().port}` };
}

test('a row written across a slow body keeps the author who sent it (Issue #810)', async (t) => {
  const { w, alice, bob, base } = await fixture(t);
  const table = w.getTable('Intake/Requests').id;
  const payload = JSON.stringify({ Name: 'Alice row' });
  let post;
  const finished = new Promise((resolve, reject) => {
    post = request(`${base}/api/tables/${table}/entities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    post.on('error', reject);
  });
  t.after(() => post.destroy());
  post.write(payload.slice(0, -1));
  await waitFor(() => w.actor === 'alice', 'the paused write holds alice');
  assert.equal((await fetch(`${base}/api/workspace`, { headers: { Authorization: `Bearer ${bob}` } })).status, 200);
  assert.equal(w.actor, 'bob');
  post.end(payload.slice(-1));
  const result = await finished;
  assert.equal(result.status, 201);
  assert.equal(w.readEntity(result.body.id).createdBy, 'alice');
  assert.equal(result.body.createdBy, 'alice');
});

test('a bug report filed across a failed forward keeps its reporter (Issue #810)', async (t) => {
  const docs = new Weave();
  seedWeaver(docs);
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  let reached = false;
  const upstream = createServer((_req, res) => {
    reached = true;
    held.then(() => res.writeHead(500).end('{}'));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const was = { url: process.env.WEAVE_BUG_FORWARD_URL, token: process.env.WEAVE_BUG_FORWARD_TOKEN, canonical: process.env.WEAVE_TRACKER_CANONICAL };
  process.env.WEAVE_BUG_FORWARD_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.WEAVE_BUG_FORWARD_TOKEN = 'forward-token';
  delete process.env.WEAVE_TRACKER_CANONICAL;
  t.after(() => {
    for (const [name, value] of [['WEAVE_BUG_FORWARD_URL', was.url], ['WEAVE_BUG_FORWARD_TOKEN', was.token], ['WEAVE_TRACKER_CANONICAL', was.canonical]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  const { w, alice, bob, base } = await fixture(t, { workspaces: { weave: docs } });
  const filed = fetch(`${base}/api/bug-report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories: ['wrong-data'], note: 'the row named the wrong writer', events: [] }),
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
  await waitFor(() => reached, 'the report reached the forward target');
  assert.equal((await fetch(`${base}/api/workspace`, { headers: { Authorization: `Bearer ${bob}` } })).status, 200);
  assert.equal(w.actor, 'bob');
  release();
  const report = await filed;
  assert.equal(report.status, 201);
  assert.equal(docs.readEntity(report.data.id).createdBy, 'alice');
});
