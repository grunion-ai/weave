import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { readHttpTracker } from '../scripts/export-development.mjs';

async function fixture(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = { path: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null };
    requests.push(request);
    res.setHeader('Content-Type', 'application/json');
    respond(request, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}/w/weave`, requests };
}

const send = (res, body) => res.end(JSON.stringify(body));
const row = (id) => ({ id, name: id, fields: {}, docs: { Description: '**retained**' } });

test('remote tracker preserves rows and auth across server-capped pages', async (t) => {
  const records = [row('one'), row('two'), row('three')];
  const { base, requests } = await fixture(t, ({ path, body }, res) => {
    send(res, path.endsWith('/workspace') ? { name: 'weave' } : { items: records.slice(body.offset, body.offset + 1), total: records.length });
  });
  const out = await readHttpTracker(base + '/', 'fixture-token', { pageSize: 2 });
  assert.deepEqual(out, { issues: records, features: records, releases: records });
  assert.ok(requests.every((r) => r.auth === 'Bearer fixture-token'));
  assert.deepEqual(requests.slice(1, 4).map((r) => r.body), [0, 1, 2].map((offset) => ({ offset, limit: 2 })));
});

test('remote tracker retains optional unauthenticated export', async (t) => {
  const { base, requests } = await fixture(t, ({ path }, res) => send(res, path.endsWith('/workspace') ? { name: 'weave' } : { items: [], total: 0 }));
  assert.deepEqual(await readHttpTracker(base), { issues: [], features: [], releases: [] });
  assert.ok(requests.every((r) => r.auth === undefined));
});

for (const base of ['http://example.invalid/w/weave', 'https://user:secret@example.invalid/w/weave', 'https://example.invalid/?token=secret', 'https://example.invalid/#secret']) {
  test(`remote tracker refuses unsafe credential destination ${base}`, async () => {
    let calls = 0;
    await assert.rejects(readHttpTracker(base, 'fixture-token', { fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ name: 'weave', items: [], total: 0 }) }; } }), /tracker URL/i);
    assert.equal(calls, 0);
  });
}

for (const status of [301, 302, 307, 308]) {
  test(`remote tracker refuses HTTP ${status} without following Location`, async (t) => {
    const { base, requests } = await fixture(t, ({ path }, res) => {
      if (path.endsWith('/workspace')) { res.writeHead(status, { Location: '/redirected' }); res.end(); }
      else send(res, { name: 'weave', items: [], total: 0 });
    });
    await assert.rejects(readHttpTracker(base, 'fixture-token'));
    assert.equal(requests.length, 1);
  });
}

for (const [name, pages] of Object.entries({
  'repeated page': [{ items: [row('one')], total: 2 }, { items: [row('one')], total: 2 }],
  'duplicate IDs within a page': [{ items: [row('one'), row('one')], total: 2 }],
  'missing row ID': [{ items: [{ name: 'one' }], total: 1 }],
  'null row': [{ items: [null], total: 1 }],
  'missing total': [{ items: [] }],
  'non-array items': [{ items: 'abc', total: 3 }],
  'negative total': [{ items: [], total: -1 }],
  'fractional total': [{ items: [], total: 0.5 }],
  'changing total': [{ items: [row('one')], total: 2 }, { items: [row('two')], total: 3 }],
  'premature empty page': [{ items: [row('one')], total: 2 }, { items: [], total: 2 }],
  'excess rows': [{ items: [row('one'), row('two')], total: 1 }],
})) {
  test(`remote tracker refuses ${name}`, async (t) => {
    let i = 0;
    const { base } = await fixture(t, ({ path }, res) => send(res, path.endsWith('/workspace') ? { name: 'weave' } : pages[Math.min(i++, pages.length - 1)]));
    await assert.rejects(readHttpTracker(base, 'fixture-token', { pageSize: 1 }), /pagination/i);
  });
}

for (const mode of ['wrong workspace', 'unauthorized']) {
  test(`remote tracker refuses ${mode} before reading tables`, async (t) => {
    const { base, requests } = await fixture(t, (_, res) => { if (mode === 'unauthorized') res.statusCode = 401; send(res, { name: 'other' }); });
    await assert.rejects(readHttpTracker(base, 'fixture-token'), mode === 'unauthorized' ? /401/ : /not the canonical/);
    assert.equal(requests.length, 1);
  });
}

for (const stage of ['headers', 'body']) {
  test(`remote tracker bounds waiting for response ${stage}`, { timeout: 3000 }, async (t) => {
    const { base } = await fixture(t, (_, res) => { if (stage === 'body') { res.writeHead(200); res.write('{'); } });
    await assert.rejects(readHttpTracker(base, 'fixture-token', { timeoutMs: 50 }), /abort|timeout/i);
  });
}
test('a bare run names the canonical command and reads nothing, so the local read copy is never exported by accident', () => {
  const run = (...args) => spawnSync(process.execPath, ['scripts/export-development.mjs', '--out', join(tempDir('exp-'), 'out.json'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: tempDir('home-') } });
  const bare = run();
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--from https:\/\/weave\.grunion\.ai\/w\/weave --token-env WEAVE_TRACKER_TOKEN/);
  assert.match(bare.stderr, /explicit path/);
  const named = run('/nonexistent/weave.db');
  assert.doesNotMatch(named.stderr, /explicit path/, 'an explicit file path still selects file mode');
});
