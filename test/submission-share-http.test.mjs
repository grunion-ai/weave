import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { createForm, updateForm } from '../src/forms.js';
import { startServer } from '../src/server.js';

async function fixture(t, options = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Reporter', type: 'text' });
  w.addField(table.id, { name: 'Amount', type: 'number' });
  const form = createForm(w, { name: 'New request', table: table.id, fields: [{ field: 'Name', required: true }, 'Amount'], hidden: { Reporter: '$actor' }, shareOnly: true });
  const grant = w.mintShare({ scope: { kind: 'table', id: table.id }, mode: 'submit', formId: form.id, expiry: 'never' });
  w.createAccount({ name: 'owner', role: 'architect' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, ...options });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = `${grant.url}/api/forms/${form.id}/submit`;
  const post = (body, headers = {}, target = path) => fetch(base + target, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const count = () => w.listEntities(table.id).length;
  return { w, table, form, grant, base, path, post, count };
}

test('anonymous submission permalink renders HTML, accepts JSON and URLencoded, returns no entity access', async t => {
  const f = await fixture(t);
  const page = await fetch(f.base + f.grant.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(`data-submit="${f.path}"`));
  assert.ok(!html.includes('owner'));
  const json = await f.post({ values: { Name: 'JSON', Amount: '2.5' } });
  assert.equal(json.status, 201);
  const receipt = await json.json();
  for (const key of ['id', 'publicId', 'url', 'table', 'workspace']) assert.equal(receipt[key], undefined, key);
  const encoded = await f.post('Name=Encoded&Amount=4', { 'Content-Type': 'application/x-www-form-urlencoded', Origin: f.base });
  assert.equal(encoded.status, 201);
  assert.equal(f.count(), 2);
  const entity = f.w.listEntities(f.table.id)[0];
  for (const path of [`${f.grant.url}/api/tables`, `${f.grant.url}/api/entities/${entity.id}`, `/api/entities/${entity.id}`]) assert.notEqual((await fetch(f.base + path)).status, 200, path);
  for (const method of ['PATCH', 'DELETE']) assert.notEqual((await fetch(`${f.base}${f.grant.url}/api/entities/${entity.id}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal(f.count(), 2);
});

test('submission token validates all input and denies hidden injection, unknown forms, CSRF and oversized bodies', async t => {
  const f = await fixture(t);
  for (const values of [{}, { Name: 'x', Amount: 'bad' }, { Name: 'x', Reporter: 'forged' }, { Name: 'x', Other: 'unknown' }]) assert.ok((await f.post({ values })).status >= 400);
  assert.equal((await f.post({ Name: 'CSRF' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post({ Name: 'x'.repeat(65536) })).status, 413);
  const other = createForm(f.w, { name: 'Other', table: f.table.id, fields: ['Name'], shareOnly: true });
  for (const id of [other.id, randomUUID()]) {
    assert.notEqual((await fetch(`${f.base}${f.grant.url}/api/forms/${id}`)).status, 200);
    assert.ok((await f.post({ Name: 'Wrong form' }, {}, `${f.grant.url}/api/forms/${id}/submit`)).status >= 400);
  }
  assert.equal(f.count(), 0);
});

test('concurrent retries and URLencoded/JSON equivalents create exactly one entry', async t => {
  const f = await fixture(t);
  const headers = { 'Idempotency-Key': randomUUID() };
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.post({ values: { Name: 'Once', Amount: 4 } }, headers)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal(f.count(), 1);
  assert.equal((await f.post('Name=Once&Amount=4', { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' })).status, 200);
  assert.equal((await f.post({ Name: 'Different' }, headers)).status, 409);
  assert.equal(f.count(), 1);
});

for (const action of ['revoke', 'expire', 'rotate', 'disable']) test(`${action} invalidates page, form API and pending submissions including receipt replay`, async t => {
  const f = await fixture(t);
  const headers = { 'Idempotency-Key': randomUUID() };
  assert.equal((await f.post({ Name: 'Before' }, headers)).status, 201);
  let replacement;
  if (action === 'revoke') f.w.revokeShare(f.grant.id);
  if (action === 'expire') { f.w.state.meta.shares[f.grant.id].expiresAt = new Date(Date.now() - 1000).toISOString(); f.w.save(); }
  if (action === 'rotate') replacement = f.w.regenerateShare(f.grant.id);
  if (action === 'disable') updateForm(f.w, f.form.id, { enabled: false });
  for (const path of [f.grant.url, `${f.grant.url}/api/forms/${f.form.id}`]) assert.notEqual((await fetch(f.base + path, { redirect: 'manual' })).status, 200, path);
  assert.ok((await f.post({ Name: 'Before' }, headers)).status >= 400);
  assert.ok((await f.post({ Name: 'After' })).status >= 400);
  assert.equal(f.count(), 1);
  if (replacement) {
    assert.equal(replacement.id, f.grant.id);
    assert.notEqual(replacement.url, f.grant.url);
    assert.equal((await f.post({ Name: 'Replacement' }, {}, `${replacement.url}/api/forms/${f.form.id}/submit`)).status, 201);
    assert.equal(f.count(), 2);
  }
});

test('submission capability rate limits before parsing and supplies retry time', async t => {
  const f = await fixture(t, { limits: { formSender: 1, formTotal: 120, formServer: 1000 } });
  assert.equal((await f.post({ Name: 'First' })).status, 201);
  const limited = await f.post('not-json');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(f.count(), 1);
});

test('submission grants reject ordinary legacy forms and mismatched/system targets', () => {
  const w = new Weave();
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  const other = w.createTable({ space: 'Intake', name: 'Other' });
  const legacy = createForm(w, { name: 'Legacy', table: table.id, fields: ['Name'], floor: 'Anonymous' });
  assert.throws(() => w.mintShare({ scope: { kind: 'table', id: table.id }, mode: 'submit', formId: legacy.id }));
  const form = createForm(w, { name: 'Restricted', table: table.id, fields: ['Name'], shareOnly: true });
  for (const id of [other.id, w.getTable('System/Forms').id]) assert.throws(() => w.mintShare({ scope: { kind: 'table', id }, mode: 'submit', formId: form.id }));
});

test('revocation while a request body arrives is rechecked inside the submission transaction', async t => {
  const f = await fixture(t);
  const payload = JSON.stringify({ Name: 'Too late' });
  let post;
  const finished = new Promise((resolve, reject) => {
    post = request(f.base + f.path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    post.on('error', reject);
  });
  t.after(() => post.destroy());
  post.write(payload.slice(0, -1));
  const deadline = Date.now() + 5000;
  while (!String(f.w.actor).startsWith('share:') && Date.now() < deadline) await setImmediate();
  assert.match(String(f.w.actor), /^share:/);
  f.w.revokeShare(f.grant.id);
  post.end(payload.slice(-1));
  assert.equal(await finished, 403);
  assert.equal(f.count(), 0);
});

test('regeneration isolates receipt identities even when a client reuses its retry key', async t => {
  const f = await fixture(t);
  const headers = { 'Idempotency-Key': randomUUID() };
  assert.equal((await f.post({ Name: 'Same values' }, headers)).status, 201);
  const replacement = f.w.regenerateShare(f.grant.id);
  assert.equal((await f.post({ Name: 'Same values' }, headers, `${replacement.url}/api/forms/${f.form.id}/submit`)).status, 201);
  assert.equal(f.count(), 2);
});

test('submission preview shows the form but cannot create an entry', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}${f.grant.url}?preview=1`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(`data-submit="${f.path}?preview=1"`));
  assert.ok(!html.includes("&#39;preview&#39; is not on"));
  assert.equal((await f.post({ Name: 'Preview' }, {}, f.path + '?preview=1')).status, 403);
  assert.equal(f.count(), 0);
});
