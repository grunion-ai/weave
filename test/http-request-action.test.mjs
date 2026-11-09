import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { withServer } from './lib/fixtures.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');

const SECRET = 'pasted-http-request-value-mnop-4242';
const HOST = 'api.example.com';

async function remote(answer = (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    answer(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url));
    sent.push(u.href);
    if (u.protocol === 'https:' && u.hostname === HOST) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
    return real(u, init);
  };
  return {
    seen, sent, port, base: `http://127.0.0.1:${port}`,
    close: () => { globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

async function workspace(api, dir = tempDir('weave-http-request-'), path = undefined) {
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Sales' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  for (const name of ['Remote Id', 'Remote Url', 'Note']) w.addField(deal.id, { name, type: 'text' });
  w.addField(deal.id, { name: 'Amount', type: 'number' });
  const ints = w.getTable('System/Integrations');
  const integration = w.createEntity(ints.id, { name: 'Acme API', values: { Provider: 'Generic API key', Host: HOST } });
  await w.setIntegrationCredential(integration.id, SECRET);
  api.seen.length = 0;
  api.sent.length = 0;
  return { w, deal, integration };
}

const ran = (w, id) => w.readEntity(id).activity.find((a) => a.kind === 'automation-ran');
const wf = (w, id) => w.readEntity(id).fields;
const everywhere = (w) => JSON.stringify([w.state, w.listAudit({ limit: 500 })]);

test('an http-request with an integration sends the key, maps the answer onto the record and feeds the next step, and the key is nowhere else', async () => {
  const api = await remote((req, res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'rem_42', links: { self: `https://${HOST}/items/rem_42` }, total: 1200, echo: SECRET }));
  });
  try {
    const { w, deal } = await workspace(api);
    const auto = w.createAutomation(deal.id, {
      name: 'Push the deal',
      trigger: { type: 'entity-created' },
      actions: [
        {
          type: 'http-request', method: 'POST', integration: 'Acme API',
          url: `https://${HOST}/v1/items/{{PublicId}}?src=weave`,
          headers: { 'X-Trace': 'deal {{Name}}' },
          body: { name: '{{Name}}', kind: 'deal', nested: ['{{PublicId}}'] },
          response: { 'Remote Id': 'id', 'Remote Url': 'links.self', Amount: 'total' },
        },
        { type: 'add-comment', text: 'pushed as {{steps.1.body.id}} ({{steps.1.status}})' },
      ],
    });
    const e = w.createEntity(deal.id, { Name: 'Acme' });
    await w.automationsSettled();

    assert.equal(api.seen.length, 1);
    const [req] = api.seen;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, `/v1/items/${e.publicId}?src=weave`);
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`, 'the key rides in the Authorization header');
    assert.equal(req.headers['x-trace'], 'deal Acme');
    assert.match(req.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(req.body), { name: 'Acme', kind: 'deal', nested: [String(e.publicId)] });

    const out = w.readEntity(e.id);
    assert.equal(out.fields['Remote Id'], 'rem_42');
    assert.equal(out.fields['Remote Url'], `https://${HOST}/items/rem_42`);
    assert.equal(out.fields.Amount, 1200);
    assert.equal(out.comments.at(-1).text, 'pushed as rem_42 (201)');
    const step = ran(w, e.id).detail.steps[0];
    assert.deepEqual(step, { status: 201, ok: true, body: { id: 'rem_42', links: { self: `https://${HOST}/items/rem_42` }, total: 1200, echo: '••••' } });
    assert.equal(wf(w, auto.id).Health, 'Healthy');
    assert.equal(wf(w, auto.id).Then, `Send a POST request to ${HOST} with Acme API, then Add a comment`);

    const audit = w.listAudit({ limit: 500 });
    const used = (audit.items ?? audit).filter((a) => a.action === 'key-used');
    assert.equal(used.length, 1);
    assert.equal(used[0].detail.path, `/v1/items/${e.publicId}`);
    assert.equal(everywhere(w).includes(SECRET), false, 'the key is in no Script, activity entry, step output, field or audit entry');
    assert.equal(JSON.stringify(w.describeAutomations(deal.id)).includes(SECRET), false);
  } finally { await api.close(); }
});

test('a rule naming an integration whose Host is not the url host is refused when written and again at send time, before a byte leaves', async () => {
  const api = await remote();
  try {
    const { w, deal, integration } = await workspace(api);
    const wrong = { type: 'http-request', method: 'GET', integration: 'Acme API', url: 'https://evil.example.org/steal' };
    assert.throws(() => w.createAutomation(deal.id, { name: 'Bad', trigger: { type: 'entity-created' }, actions: [wrong] }), /only reaches https:\/\/api\.example\.com/);
    assert.throws(() => w.createAutomation(deal.id, { name: 'Plain', trigger: { type: 'entity-created' }, actions: [{ ...wrong, url: `http://${HOST}/x` }] }), /only reaches https:\/\/api\.example\.com/);

    const wfT = w.getTable('System/Workflows');
    const row = w.createEntity(wfT.id, { values: { Name: 'Grid rule' }, docs: { Script: JSON.stringify({ table: 'Sales/Deal', trigger: { type: 'entity-created' }, actions: [wrong] }) } });
    assert.equal(wf(w, row.id).State, 'Setup incomplete');
    assert.match(w.listAutomations().find((a) => a.id === row.id).problem, /evil\.example\.org/);

    const auto = w.createAutomation(deal.id, {
      name: 'Moves later',
      trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'GET', integration: 'Acme API', url: `https://${HOST}/ok` }, { type: 'add-comment', text: 'after' }],
    });
    w.updateEntity(integration.id, { On: false });
    const off = w.createEntity(deal.id, { Name: 'Off' });
    await w.automationsSettled();
    assert.equal(wf(w, auto.id).State, 'Ready');
    assert.equal(wf(w, auto.id).Health, 'Failed');
    assert.match(wf(w, auto.id)['Health Reason'], /^GET api\.example\.com\/ok: Integration 'Acme API' is Off/);
    assert.equal(w.readEntity(off.id).comments.length, 0, 'the later step did not run');
    assert.equal(ran(w, off.id).detail.failed.step, 1);

    w.updateEntity(integration.id, { On: true, Host: 'other.example.com' });
    const moved = w.createEntity(deal.id, { Name: 'Moved' });
    await w.automationsSettled();
    assert.equal(wf(w, auto.id).State, 'Setup incomplete');
    assert.match(wf(w, auto.id)['Health Reason'], /only reaches https:\/\/other\.example\.com: refused https:\/\/api\.example\.com/);
    assert.equal(w.readEntity(moved.id).comments.length, 0);
    assert.equal(api.sent.length, 0, 'no request left weave');
    assert.equal(api.seen.length, 0);
  } finally { await api.close(); }
});

test('a Script never carries a credential: Authorization, Proxy-Authorization and Cookie headers are refused, as are a templated host, an unknown method and unknown fields', async () => {
  const api = await remote();
  try {
    const { w, deal } = await workspace(api);
    const make = (action) => () => w.createAutomation(deal.id, { name: 'x', trigger: { type: 'entity-created' }, actions: [{ type: 'http-request', url: `https://${HOST}/x`, ...action }] });
    for (const headers of [{ Authorization: 'Bearer typed-in' }, { 'proxy-authorization': 'x' }, { Cookie: 'a=b' }]) {
      assert.throws(make({ headers }), /System\/Integrations/);
    }
    assert.throws(make({ url: 'https://{{Note}}/x' }), /scheme and host/);
    assert.throws(make({ url: 'ftp://example.com/x' }), /http\(s\) url/);
    assert.throws(make({ method: 'TRACE' }), /TRACE/);
    assert.throws(make({ integration: 'Nope' }), /No integration 'Nope'/);
    assert.throws(make({ response: { Missing: 'id' } }), /Missing/);
    assert.throws(make({ response: { 'Remote Id': '' } }), /path/);
    assert.throws(make({ headers: { 'X-A': 5 } }), /header/);
  } finally { await api.close(); }
});

test('with no integration the request goes out unauthenticated and the SSRF guard refuses a private address', async () => {
  const api = await remote((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"queued":true}'); });
  try {
    const { w, deal } = await workspace(api);
    const auto = w.createAutomation(deal.id, {
      name: 'Hook',
      trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'PUT', url: `${api.base}/hook/{{PublicId}}`, body: 'deal={{Name}}', headers: { 'Content-Type': 'text/plain' } }],
    });
    const e = w.createEntity(deal.id, { Name: 'Open' });
    await w.automationsSettled();
    assert.equal(api.seen.length, 1);
    assert.equal(api.seen[0].headers.authorization, undefined);
    assert.equal(api.seen[0].body, 'deal=Open');
    assert.deepEqual(ran(w, e.id).detail.steps[0], { status: 200, ok: true, body: { queued: true } });
    assert.equal(wf(w, auto.id).Health, 'Healthy');

    delete process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE;
    try {
      w.createEntity(deal.id, { Name: 'Guarded' });
      await w.automationsSettled();
    } finally { process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1'; }
    assert.equal(api.seen.length, 1, 'the private address was refused before a byte left');
    assert.equal(wf(w, auto.id).Health, 'Failed');
    assert.match(wf(w, auto.id)['Health Reason'], /private or local address/);
  } finally { await api.close(); }
});

test('a 4xx answer stamps Failed with a reason and stops the later steps; a timeout holds them while its retry waits', async () => {
  let mode = '404';
  const api = await remote((req, res) => {
    if (mode === 'hang') return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"no such item"}');
  });
  try {
    const { w, deal } = await workspace(api);
    w.webhookTimeoutMs = 200;
    const auto = w.createAutomation(deal.id, {
      name: 'Fetch',
      trigger: { type: 'entity-created' },
      actions: [
        { type: 'http-request', method: 'GET', url: `${api.base}/items/{{PublicId}}`, response: { 'Remote Id': 'id' } },
        { type: 'add-comment', text: 'after' },
      ],
    });
    const e = w.createEntity(deal.id, { Name: 'Missing' });
    await w.automationsSettled();
    assert.equal(wf(w, auto.id).Health, 'Failed');
    assert.match(wf(w, auto.id)['Health Reason'], new RegExp(`GET 127\\.0\\.0\\.1:${api.port}/items/${e.publicId} answered HTTP 404`));
    assert.equal(w.readEntity(e.id).comments.length, 0);
    assert.equal(w.readEntity(e.id).fields['Remote Id'] ?? null, null);
    assert.equal(ran(w, e.id).detail.failed.step, 1);

    mode = 'hang';
    const late = w.createEntity(deal.id, { Name: 'Slow' });
    await w.automationsSettled();
    assert.equal(wf(w, auto.id).Health, 'Warning');
    assert.match(wf(w, auto.id)['Health Reason'], /did not answer within 0\.2 s; attempt 1 of 8 failed/);
    assert.equal(w.readEntity(late.id).comments.length, 0);
  } finally { await api.close(); }
});

test('the step output is bounded: an oversize answer still maps its fields but keeps no body', async () => {
  const api = await remote((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'big_1', blob: 'x'.repeat(40_000) }));
  });
  try {
    const { w, deal } = await workspace(api);
    w.createAutomation(deal.id, {
      name: 'Big',
      trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'GET', url: `${api.base}/big`, response: { 'Remote Id': 'id' } }],
    });
    const e = w.createEntity(deal.id, { Name: 'B' });
    await w.automationsSettled();
    assert.equal(w.readEntity(e.id).fields['Remote Id'], 'big_1');
    const step = ran(w, e.id).detail.steps[0];
    assert.deepEqual(step, { status: 200, ok: true, body: null, truncated: true });
  } finally { await api.close(); }
});

test('what lands after the answer is saved: a reopened workspace has the mapped field, the run and the Health', async () => {
  const api = await remote((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"kept_1"}'); });
  try {
    const dir = tempDir('weave-http-request-file-');
    const path = join(dir, 'w.db');
    const { w, deal } = await workspace(api, dir, path);
    const auto = w.createAutomation(deal.id, {
      name: 'Kept',
      trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', integration: 'Acme API', url: `https://${HOST}/v1/items`, body: { n: '{{Name}}' }, response: { 'Remote Id': 'id' } }],
    });
    const e = w.createEntity(deal.id, { Name: 'Saved' });
    await w.automationsSettled();
    const again = new Weave({ path, keystorePath: join(dir, 'keystore.json') });
    assert.equal(again.readEntity(e.id).fields['Remote Id'], 'kept_1');
    assert.deepEqual(ran(again, e.id).detail.steps[0], { status: 200, ok: true, body: { id: 'kept_1' } });
    assert.equal(wf(again, auto.id).Health, 'Healthy');
    assert.ok(wf(again, auto.id)['Last Run']);
  } finally { await api.close(); }
});

test('the REST door writes the rule and a record created over HTTP gets the mapped answer', async () => {
  const api = await remote((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":{"id":"rest_7"}}'); });
  try {
    const { w } = await workspace(api);
    await withServer(w, async ({ fetch }) => {
      const json = { 'Content-Type': 'application/json' };
      const made = await fetch('/api/automations', { method: 'POST', headers: json, body: JSON.stringify({
        db: 'Sales/Deal', name: 'Over REST', trigger: { type: 'entity-created' },
        actions: [{ type: 'http-request', method: 'POST', integration: 'Acme API', url: `https://${HOST}/v2/records`, body: { title: '{{Name}}' }, response: { 'Remote Id': 'data.id' } }],
      }) });
      assert.equal(made.status, 201, await made.clone().text());
      const row = await (await fetch('/api/tables/Sales%2FDeal/entities', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Via HTTP' }) })).json();
      await w.automationsSettled();
      assert.equal(w.readEntity(row.id).fields['Remote Id'], 'rest_7');
      const described = await (await fetch('/api/automations?db=Sales%2FDeal')).json();
      assert.deepEqual(described.find((r) => r.name === 'Over REST').actions[0], { type: 'http-request', method: 'POST', url: `https://${HOST}/v2/records`, integration: 'Acme API' });
    });
    assert.equal(api.seen[0].headers.authorization, `Bearer ${SECRET}`);
    assert.equal(everywhere(w).includes(SECRET), false);
  } finally { await api.close(); }
});
