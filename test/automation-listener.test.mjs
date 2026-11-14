import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const SECRET = 'pasted-listener-value-wxyz-3131';
const HOST = 'api.example.com';
const MINUTE = 60_000;
const START = Date.parse('2026-11-09T12:00:00Z');

async function source() {
  const list = { data: [{ id: 't1', title: 'One', status: 'open' }, { id: 't2', title: 'Two', status: 'open' }] };
  const api = { list, seen: [], answer: null, etag: null, cursor: null };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    api.seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.method !== 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    if (api.answer) { const a = api.answer; api.answer = null; a(req, res); return; }
    const text = JSON.stringify(api.cursor ? { ...api.list, next: api.cursor } : api.list);
    const tag = api.etag ? `"${api.etag}"` : null;
    if (tag && req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...(tag ? { ETag: tag } : {}) });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && u.hostname === HOST) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
    return real(u, init);
  };
  api.gets = () => api.seen.filter((s) => s.method === 'GET' && s.url.startsWith('/v1/tasks'));
  api.close = () => { globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  return api;
}

async function workspace(api, { dir = tempDir('weave-listener-'), path, budget } = {}) {
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  const clock = { t: START };
  w.now = () => new Date(clock.t);
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  for (const name of ['Remote Id', 'Status']) w.addField(task.id, { name, type: 'text' });
  const ints = w.getTable('System/Integrations');
  const integration = w.createEntity(ints.id, { name: 'Acme API', values: { Provider: 'Generic API key', Host: HOST, ...(budget ? { 'Poll Budget': budget } : {}) } });
  await w.setIntegrationCredential(integration.id, SECRET);
  api.seen.length = 0;
  return { w, task, integration, clock, dir };
}

const mirror = (extra = {}) => ({
  name: 'Mirror tasks',
  trigger: { type: 'listener-changed', integration: 'Acme API', url: `https://${HOST}/v1/tasks?view=all`, items: 'data', key: 'id', ...extra },
  actions: [{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields: { 'Remote Id': 'trigger.item.id', Name: 'trigger.item.title', Status: 'trigger.item.status' } }],
});

async function tick(w, clock, minutes = 1) {
  clock.t += minutes * MINUTE;
  w.runSchedules();
  await w.automationsSettled();
}
const rows = (w, task) => w.listEntities(task.id).map((e) => w.readEntity(e.id).fields);
const wf = (w, id) => w.readEntity(id).fields;

test('a listener-changed rule compiles with When and Then words, and refuses what it cannot poll', async () => {
  const api = await source();
  try {
    const { w, task } = await workspace(api);
    const auto = w.createAutomation(task.id, mirror());
    const f = wf(w, auto.id);
    assert.equal(f.State, 'Ready');
    assert.equal(f.When, 'An item changes at api.example.com/v1/tasks through Acme API');
    assert.equal(f.Then, 'Create or update a record in Ops/Task by Remote Id');
    const [d] = w.describeAutomations(task.id);
    assert.equal(d.trigger.type, 'listener-changed');
    assert.equal(d.trigger.integration, 'Acme API');
    assert.equal(d.trigger.items, 'data');
    assert.equal(d.trigger.key, 'id');
    assert.throws(() => w.createAutomation(task.id, mirror({ url: 'https://other.example.com/v1/tasks' })), /only reaches https:\/\/api\.example\.com/);
    assert.throws(() => w.createAutomation(task.id, mirror({ key: '' })), /key/);
    assert.throws(() => w.createAutomation(task.id, mirror({ integration: '' })), /integration/);
    assert.throws(() => w.createAutomation(task.id, mirror({ headers: { Authorization: 'x' } })), /Authorization/);
    assert.throws(() => w.createAutomation(task.id, { ...mirror(), actions: [{ type: 'add-comment', text: 'x' }] }), /upsert-row or http-request/);
  } finally { await api.close(); }
});

test('the first poll records the source and fires nothing; the next poll fires once per changed or new item with the item as input', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const auto = w.createAutomation(task.id, mirror());
    await tick(w, clock, 0);
    assert.equal(api.gets().length, 1, 'the first tick polls');
    assert.equal(w.listEntities(task.id).length, 0, 'the first poll is the baseline and fires nothing');
    assert.match(wf(w, auto.id)['Health Reason'], /^Last poll 2026-11-09 12:00 UTC, next 2026-11-09 12:01 UTC, 2 items seen$/);
    api.list.data[1] = { ...api.list.data[1], status: 'done' };
    api.list.data.push({ id: 't3', title: 'Three', status: 'open' });
    await tick(w, clock);
    assert.equal(api.gets().length, 2);
    const got = rows(w, task).map((r) => [r['Remote Id'], r.Name, r.Status]).sort();
    assert.deepEqual(got, [['t2', 'Two', 'done'], ['t3', 'Three', 'open']], 'one fire per changed or new item, never for t1');
    const f = wf(w, auto.id);
    assert.equal(f.Health, 'Healthy');
    assert.ok(f['Last Run']);
    assert.match(f['Health Reason'], /3 items seen$/);
    await tick(w, clock);
    assert.equal(w.listEntities(task.id).length, 2, 'an unchanged source fires nothing');
  } finally { await api.close(); }
});

test('an unchanged source is polled less often, down to the Script floor; a change brings it back to every tick', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    w.createAutomation(task.id, mirror({ maxInterval: 4 }));
    await tick(w, clock, 0);
    for (let i = 0; i < 15; i++) await tick(w, clock);
    const at = api.gets().map((_, i) => i);
    assert.equal(api.gets().length, 6, `16 ticks, polls at 0, 1, 3, 7, 11, 15 minutes (got ${at.length})`);
    api.list.data[0] = { ...api.list.data[0], title: 'One again' };
    await tick(w, clock, 4);
    const before = api.gets().length;
    await tick(w, clock);
    assert.equal(api.gets().length, before + 1, 'after a change the next tick polls');
  } finally { await api.close(); }
});

test('the ETag and the cursor go back to the source, and a 304 counts as unchanged', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    api.etag = 'v1';
    api.cursor = 'c-100';
    w.createAutomation(task.id, mirror({ cursor: { param: 'since', path: 'next' } }));
    await tick(w, clock, 0);
    assert.equal(new URL(api.gets()[0].url, 'http://x').searchParams.get('since'), null);
    await tick(w, clock);
    const second = api.gets()[1];
    assert.equal(new URL(second.url, 'http://x').searchParams.get('since'), 'c-100', 'the stored cursor rides as the since parameter');
    assert.equal(new URL(second.url, 'http://x').searchParams.get('view'), 'all', 'the Script query stays');
    assert.equal(second.headers['if-none-match'], '"v1"');
    assert.equal(w.listEntities(task.id).length, 0, 'a 304 fires nothing');
    await tick(w, clock);
    assert.equal(api.gets().length, 2, 'a 304 lengthens the interval like an unchanged answer');
  } finally { await api.close(); }
});

test('with a cursor the answer holds only changes, so items it leaves out stay in the snapshot', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    api.cursor = 'c-1';
    w.createAutomation(task.id, mirror({ cursor: { param: 'since', path: 'next' } }));
    await tick(w, clock, 0);
    api.list.data = [{ id: 't1', title: 'One', status: 'done' }];
    await tick(w, clock);
    api.list.data = [{ id: 't2', title: 'Two', status: 'open' }];
    await tick(w, clock);
    assert.deepEqual(rows(w, task).map((r) => r['Remote Id']), ['t1'], 't2 came back unchanged and does not fire');
  } finally { await api.close(); }
});

test('a 429 with Retry-After backs the rule off and reads Warning with the reason, then the next poll reads Healthy', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const auto = w.createAutomation(task.id, mirror());
    await tick(w, clock, 0);
    api.answer = (req, res) => { res.writeHead(429, { 'Retry-After': '300' }); res.end('slow down'); };
    await tick(w, clock);
    const f = wf(w, auto.id);
    assert.equal(f.Health, 'Warning');
    assert.equal(f['Health Reason'], 'GET api.example.com/v1/tasks answered HTTP 429; next poll 2026-11-09 12:06 UTC');
    for (let i = 0; i < 4; i++) await tick(w, clock);
    assert.equal(api.gets().length, 2, 'no poll while the source asked to wait');
    await tick(w, clock);
    assert.equal(api.gets().length, 3, 'the poll resumes after Retry-After');
    assert.equal(wf(w, auto.id).Health, 'Healthy');
  } finally { await api.close(); }
});

test('the Poll Budget on the integration caps the polls of every rule on it within an hour', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api, { budget: 5 });
    w.createAutomation(task.id, mirror());
    w.createAutomation(task.id, { ...mirror(), name: 'Mirror again', trigger: { ...mirror().trigger, url: `https://${HOST}/v1/tasks?view=open` } });
    await tick(w, clock, 0);
    for (let i = 0; i < 10; i++) {
      api.list.data[0] = { ...api.list.data[0], title: `One ${i}` };
      await tick(w, clock);
    }
    assert.equal(api.gets().length, 5, 'two rules that would poll every tick share five polls an hour');
    clock.t += 60 * MINUTE;
    await tick(w, clock);
    assert.ok(api.gets().length > 5, 'the hour rolls over and polls resume');
  } finally { await api.close(); }
});

test('a items path that finds no list reads Setup incomplete with the reason, and polling stops', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const auto = w.createAutomation(task.id, mirror({ items: 'results' }));
    await tick(w, clock, 0);
    const f = wf(w, auto.id);
    assert.equal(f.State, 'Setup incomplete');
    assert.equal(f['Health Reason'], "Setup incomplete: the items path 'results' finds no list in the answer from GET api.example.com/v1/tasks");
    await tick(w, clock, 5);
    assert.equal(api.gets().length, 1);
  } finally { await api.close(); }
});

test('a change weave itself just sent to the source is an echo and does not fire', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const ops = w.createTable({ space: 'Ops', name: 'Push' });
    w.createAutomation(ops.id, {
      name: 'Close remote',
      trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'PATCH', integration: 'Acme API', url: `https://${HOST}/v1/tasks/t1`, body: { status: 'done' } }],
    });
    w.createAutomation(task.id, mirror());
    await tick(w, clock, 0);
    w.createEntity(ops.id, { Name: 'close t1' });
    await w.automationsSettled();
    api.list.data[0] = { ...api.list.data[0], status: 'done' };
    api.list.data[1] = { ...api.list.data[1], status: 'done', title: 'Two edited' };
    await tick(w, clock);
    assert.deepEqual(rows(w, task).map((r) => r['Remote Id']), ['t2'], 't1 changed only by weave\'s own write; t2 changed at the source');
  } finally { await api.close(); }
});

test('a box that slept polls once on wake, not once per missed tick', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    w.createAutomation(task.id, mirror());
    await tick(w, clock, 0);
    await tick(w, clock, 180);
    assert.equal(api.gets().length, 2);
  } finally { await api.close(); }
});

test('a restart keeps the snapshot and the cursor, and the credential appears nowhere but the request', async () => {
  const api = await source();
  try {
    const dir = tempDir('weave-listener-restart-');
    const path = join(dir, 'ws.db');
    api.cursor = 'c-7';
    const first = await workspace(api, { dir, path });
    first.w.createAutomation(first.task.id, mirror({ cursor: { param: 'since', path: 'next' } }));
    await tick(first.w, first.clock, 0);
    first.w.save();
    first.w.close?.();
    const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
    const clock = { t: first.clock.t };
    w.now = () => new Date(clock.t);
    api.list.data[0] = { ...api.list.data[0], status: 'done' };
    await tick(w, clock);
    const last = api.gets().at(-1);
    assert.equal(new URL(last.url, 'http://x').searchParams.get('since'), 'c-7', 'the cursor survived');
    const task = w.getTable('Ops/Task');
    assert.deepEqual(rows(w, task).map((r) => r['Remote Id']), ['t1'], 'the snapshot survived: only t1 fires');
    assert.equal(last.headers.authorization.includes(SECRET), true, 'the key rides on the request');
    w.save();
    assert.equal(JSON.stringify(w.state).includes(SECRET), false, 'not in the workspace state');
    for (const auto of w.describeAutomations()) assert.equal(JSON.stringify(auto).includes(SECRET), false);
    for (const name of readdirSync(dir).filter((n) => n.startsWith('ws.db'))) {
      assert.equal(readFileSync(join(dir, name)).includes(SECRET), false, `not in ${name}`);
    }
  } finally { await api.close(); }
});
