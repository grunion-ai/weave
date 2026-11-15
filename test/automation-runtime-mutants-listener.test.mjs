import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const SECRET = 'pasted-listener-value-wxyz-4242';
const HOST = 'api.example.com';
const MINUTE = 60_000;
const START = Date.parse('2026-11-09T12:00:00Z');
async function source() {
  const api = { list: { data: [{ id: 't1', title: 'One', status: 'open' }] }, seen: [], answer: null };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    api.seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.method !== 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    if (api.answer) { const a = api.answer; api.answer = null; a(req, res); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(api.list));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && u.hostname === HOST) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
    return real(u, init);
  };
  api.posts = () => api.seen.filter((s) => s.method === 'POST');
  api.close = () => { globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  return api;
}
async function workspace(api) {
  const dir = tempDir('weave-runtime-mutants-');
  const w = new Weave({ actor: 'kyle', keystorePath: join(dir, 'keystore.json') });
  const clock = { t: START };
  w.now = () => new Date(clock.t);
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  for (const name of ['Remote Id', 'Status']) w.addField(task.id, { name, type: 'text' });
  const ints = w.getTable('System/Integrations');
  const integration = w.createEntity(ints.id, { name: 'Acme API', values: { Provider: 'Generic API key', Host: HOST } });
  await w.setIntegrationCredential(integration.id, SECRET);
  api.seen.length = 0;
  return { w, task, clock };
}
const upsert = [{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields: { 'Remote Id': 'trigger.item.id', Name: 'trigger.item.title', Status: 'trigger.item.status' } }];
const listener = (actions, extra = {}) => ({
  name: 'Watch tasks',
  trigger: { type: 'listener-changed', integration: 'Acme API', url: `https://${HOST}/v1/tasks`, items: 'data', key: 'id', ...extra },
  actions,
});
async function tick(w, clock, minutes = 1) {
  clock.t += minutes * MINUTE;
  w.runSchedules();
  await w.automationsSettled();
}
const wf = (w, id) => w.readEntity(id).fields;

test('two failed polls in a row push the next poll out further each time', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const auto = w.createAutomation(task.id, listener(upsert));
    await tick(w, clock, 0);
    api.answer = (req, res) => { res.writeHead(500); res.end('down'); };
    await tick(w, clock);
    assert.equal(wf(w, auto.id)['Health Reason'], 'GET api.example.com/v1/tasks answered HTTP 500; next poll 2026-11-09 12:02 UTC');
    api.answer = (req, res) => { res.writeHead(500); res.end('down'); };
    await tick(w, clock);
    assert.equal(wf(w, auto.id)['Health Reason'], 'GET api.example.com/v1/tasks answered HTTP 500; next poll 2026-11-09 12:04 UTC');
    api.answer = (req, res) => { res.writeHead(500); res.end('down'); };
    await tick(w, clock, 2);
    assert.equal(wf(w, auto.id)['Health Reason'], 'GET api.example.com/v1/tasks answered HTTP 500; next poll 2026-11-09 12:08 UTC');
  } finally { await api.close(); }
});

test('a poll that cannot finish is logged with the plain error message', async () => {
  const api = await source();
  const real = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const { w, task, clock } = await workspace(api);
    w.createAutomation(task.id, listener(upsert));
    w.save = () => { throw new Error('disk is full'); };
    await tick(w, clock, 0);
    assert.deepEqual(logged, ["weave: poll for 'Watch tasks' failed: disk is full"]);
  } finally { console.error = real; await api.close(); }
});

test('a listener rule sends the polled item to an http-request body through trigger.item', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    w.createAutomation(task.id, listener([{
      type: 'http-request', method: 'POST', integration: 'Acme API', url: `https://${HOST}/v1/echo`, body: { heard: '{{trigger.item.title}}', id: '{{trigger.item.id}}' },
    }]));
    await tick(w, clock, 0);
    api.list = { data: [{ id: 't1', title: 'Renamed', status: 'open' }] };
    await tick(w, clock);
    assert.equal(api.posts().length, 1);
    assert.deepEqual(JSON.parse(api.posts()[0].body), { heard: 'Renamed', id: 't1' });
  } finally { await api.close(); }
});

test('renaming a field leaves a rule that reads Setup incomplete untouched', async () => {
  const api = await source();
  try {
    const { w, task, clock } = await workspace(api);
    const fields = { 'Remote Id': 'trigger.item.id', Name: 'trigger.item.title', Status: 'row.Status' };
    const broken = w.createAutomation(task.id, listener([{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields }], { items: 'results' }));
    const healthy = w.createAutomation(task.id, { ...listener([{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields }]), name: 'Healthy mirror' });
    await tick(w, clock, 0);
    assert.equal(wf(w, broken.id).State, 'Setup incomplete');
    const script = (id) => w.readEntity(id).docs.Script;
    assert.match(script(broken.id), /row\.Status/);
    w.updateField(task.id, 'Status', { name: 'Stage' });
    assert.match(script(broken.id), /row\.Status/);
    assert.match(script(healthy.id), /row\.Stage/);
  } finally { await api.close(); }
});
