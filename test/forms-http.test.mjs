import test from 'node:test';
import { request } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createForm } from '../src/forms.js';
import { startServer } from '../src/server.js';

async function fixture(t, options = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Intake' });
  w.createTable({ space: 'Intake', name: 'Requests' });
  const form = createForm(w, { name: 'Requests', table: 'Intake/Requests', fields: ['Name'] });
  const { server } = await startServer(w, { port: 0, ...options });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { w, form, base, send: (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers, body }) };
}

test('form permalink accepts flat URLencoded and wrapped JSON with safe retries', async (t) => {
  const { w, form, base, send } = await fixture(t);
  const first = await send(`/f/${form.id}`, 'Name=Hello&idempotencyKey=8a07ec72-e021-4f2e-b3a7-0d3f8af952f5', { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base });
  assert.equal(first.status, 201);
  const receipt = await first.json();
  const retry = await send(`/api/forms/${form.id}/submit`, JSON.stringify({ values: { Name: 'Hello' } }), { 'Content-Type': 'application/json', 'Idempotency-Key': '8a07ec72-e021-4f2e-b3a7-0d3f8af952f5' });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, receipt.id);
  assert.equal(w.listEntities(w.getTable('Intake/Requests').id).length, 1);
});

test('form limits reject before reading body and supply Retry-After', async (t) => {
  const { form, send } = await fixture(t, { limits: { formSender: 1, formTotal: 120, formServer: 1000 } });
  assert.equal((await send(`/f/${form.id}`, '{"Name":"First"}', { 'Content-Type': 'application/json' })).status, 201);
  const limited = await send(`/f/${form.id}`, 'not json', { 'Content-Type': 'application/json' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('form transport keeps cross-origin and unrelated JSON gates, limits body size', async (t) => {
  const { form, base, send } = await fixture(t);
  assert.equal((await send(`/f/${form.id}`, 'Name=Bad', { Origin: 'https://other.example', 'Content-Type': 'application/x-www-form-urlencoded' })).status, 403);
  assert.equal((await send('/api/tables/Requests/entities', 'Name=Bad', { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' })).status, 400);
  assert.equal((await send(`/f/${form.id}`, JSON.stringify({ Name: 'x'.repeat(65536) }), { 'Content-Type': 'application/json' })).status, 413);
});

test('form and server buckets constrain independent senders and forms', async (t) => {
  const { w, form, send } = await fixture(t, { trustProxy: true, limits: { formSender: 20, formTotal: 1, formServer: 2 } });
  const other = createForm(w, { name: 'Other', table: 'Intake/Requests', fields: ['Name'] });
  const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.1' };
  assert.equal((await send(`/f/${form.id}`, '{"Name":"First"}', headers)).status, 201);
  assert.equal((await send(`/f/${form.id}`, '{"Name":"Second"}', { ...headers, 'X-Forwarded-For': '192.0.2.2' })).status, 429);
  assert.equal((await send(`/f/${other.id}`, '{"Name":"Third"}', headers)).status, 429);
});

test('anonymous receipts use independent browser cookies and strong retry capabilities', async (t) => {
  const previous = process.env.WEAVE_ANONYMOUS_FORMS;
  process.env.WEAVE_ANONYMOUS_FORMS = '1';
  let f;
  try { f = await fixture(t); } finally {
    if (previous === undefined) delete process.env.WEAVE_ANONYMOUS_FORMS;
    else process.env.WEAVE_ANONYMOUS_FORMS = previous;
  }
  const { w, base, send } = f;
  w.createAccount({ name: 'owner', role: 'architect' });
  w.setRequireAuth(true);
  const form = createForm(w, { name: 'Public', table: 'Intake/Requests', fields: ['Name'], floor: 'Anonymous' });
  const page = await fetch(`${base}/f/${form.id}`);
  const cookie = page.headers.get('set-cookie');
  assert.match(cookie, /wv_form_client=[\w-]{43}; HttpOnly; SameSite=Lax/);
  const headers = { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] };
  const one = await send(`/f/${form.id}`, '{"Name":"Same"}', headers);
  const first = await one.json();
  assert.equal(one.status, 201);
  const two = await send(`/f/${form.id}`, '{"Name":"Same"}', headers);
  assert.equal(two.status, 200);
  assert.equal((await two.json()).id, first.id);
  const newKey = await send(`/f/${form.id}`, '{"Name":"Same"}', { ...headers, 'Idempotency-Key': crypto.randomUUID() });
  assert.equal(newKey.status, 200);
  assert.equal((await newKey.json()).id, first.id);
  const separate = await send(`/f/${form.id}`, '{"Name":"Same"}', { 'Content-Type': 'application/json' });
  assert.equal(separate.status, 201);
  assert.notEqual((await separate.json()).id, first.id);
  assert.equal((await send(`/f/${form.id}`, '{"Name":"Keyed"}', { ...headers, 'Idempotency-Key': 'guessable' })).status, 400);
  const keyed = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  const original = await send(`/f/${form.id}`, '{"Name":"Keyed"}', keyed);
  const replay = await send(`/f/${form.id}`, '{"Name":"Keyed"}', { ...keyed, Cookie: original.headers.get('set-cookie').split(';')[0] });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, (await original.json()).id);
});

test('form login preserves encoded prefill query and GET never submits', async (t) => {
  const { w, form, base } = await fixture(t, { oidc: { name: 'Provider' } });
  w.createAccount({ name: 'owner', role: 'architect' });
  w.setRequireAuth(true);
  const path = `/f/${form.id}?Name=Hello%20world&prefill_Notes=a%26b`;
  const response = await fetch(base + path, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const next = new URL(response.headers.get('location'), base).searchParams.get('next');
  assert.equal(next, `/f/${form.id}?Name=Hello+world&prefill_Notes=a%26b`);
  assert.equal(w.listEntities(w.getTable('Intake/Requests').id).length, 0);
});

test('signed-in observers submit URLencoded forms with their identity and retry key', async (t) => {
  const { w, form, base, send } = await fixture(t);
  const { token } = w.createAccount({ name: 'reader', role: 'observer' });
  w.setRequireAuth(true);
  const headers = { Origin: base, Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'signed-in-retry' };
  const response = await send(`/f/${form.id}`, 'Name=Observer', headers);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(w.readEntity(receipt.id).createdBy, 'reader');
  assert.equal((await send(`/f/${form.id}`, 'Name=Observer', headers)).status, 200);
  assert.equal((await send(`/f/${form.id}`, 'Name=Forged', { ...headers, Origin: 'https://evil.example' })).status, 403);
  assert.equal(w.listEntities(w.getTable('Intake/Requests').id).length, 1);
});


test('an interleaved request cannot change the authenticated form author or receipt owner', async (t) => {
  const { w, form, base, send } = await fixture(t);
  const alice = w.createAccount({ name: 'alice', role: 'observer' }).token;
  const bob = w.createAccount({ name: 'bob', role: 'observer' }).token;
  w.setRequireAuth(true);
  const payload = JSON.stringify({ values: { Name: 'Alice request' } });
  let post;
  const finished = new Promise((resolve, reject) => {
    post = request(`${base}/f/${form.id}`, { method: 'POST', headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Idempotency-Key': 'alice-request' } }, response => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    post.on('error', reject);
  });
  t.after(() => post.destroy());
  post.write(payload.slice(0, -1));
  const deadline = Date.now() + 5000;
  while (w.actor !== 'alice' && Date.now() < deadline) await setImmediate();
  assert.equal(w.actor, 'alice');
  assert.equal((await fetch(`${base}/api/forms/${form.id}`, { headers: { Authorization: `Bearer ${bob}` } })).status, 200);
  assert.equal(w.actor, 'bob');
  post.end(payload.slice(-1));
  const result = await finished;
  assert.equal(result.status, 201);
  assert.equal(w.readEntity(result.body.id).createdBy, 'alice');
  const retry = await send(`/f/${form.id}`, payload, { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'alice-request' });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, result.body.id);
  const independent = await send(`/f/${form.id}`, payload, { Authorization: `Bearer ${bob}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'alice-request' });
  assert.equal(independent.status, 201);
  assert.notEqual((await independent.json()).id, result.body.id);
});
