import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Weave } from '../src/engine.js';
import { seedWeaver, syncDevelopment } from '../src/weaver-seed.js';
import { renderBugReport } from '../src/bugreport.js';
import { startServer } from '../src/server.js';
import { ROOT } from './lib/source.mjs';
import { bootAndStop } from './lib/serve-fixture.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const EXPORT = join(ROOT, 'scripts', 'export-development.mjs');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs', 'development.json'), 'utf8'));
const dir = tempDir('weave-tracker-canonical-');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const FORWARD_ENV = ['WEAVE_TRACKER_CANONICAL', 'WEAVE_BUG_FORWARD_URL', 'WEAVE_BUG_FORWARD_TOKEN', 'WEAVE_ORIGIN'];
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(FORWARD_ENV.map((k) => [k, process.env[k]]));
  for (const k of FORWARD_ENV) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const k of FORWARD_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

const target = MANIFEST.issues.find((i) => i.status === 'Fixed') ?? MANIFEST.issues[0];
const otherStatus = target.status === 'Open' ? 'Fixed' : 'Open';

function editedDocs(sub) {
  const docsPath = join(sub, 'weave.db');
  const docs = seedWeaver(new Weave({ path: docsPath }));
  docs.state.meta.name = 'weave';
  syncDevelopment(docs, MANIFEST);
  const row = docs.findEntity(docs.getTable('Development/Issue'), target.name);
  docs.setState(row.id, 'Status', otherStatus);
  docs.state.meta.developmentSync = 'an older build';
  docs.save();
  docs.store.close?.();
  return docsPath;
}
const statusAfterBoot = async (env) => {
  const sub = mkdtempSync(join(dir, 'boot-'));
  const docsPath = editedDocs(sub);
  const child = spawn('node', [BIN, 'serve', '--port', '0', '--data', join(sub, 'ws.db')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WEAVE_UPDATE_CHECK: 'off', WEAVE_TRACKER_CANONICAL: '', ...env },
  });
  const log = await bootAndStop(child);
  const w = new Weave({ path: docsPath });
  try {
    return { log, status: w.readEntity(w.findEntity(w.getTable('Development/Issue'), target.name).id).fields.Status };
  } finally { w.store.close?.(); }
};

test('a canonical server keeps a tracker edit when a newer manifest boots, and says why it skipped the sync', async () => {
  const { log, status } = await statusAfterBoot({ WEAVE_TRACKER_CANONICAL: '1' });
  assert.equal(status, otherStatus, 'the edit made on the canonical tracker survives the boot');
  assert.match(log, /Development sync skipped: this server is the canonical tracker \(WEAVE_TRACKER_CANONICAL=1\)/);
});

test('a read-copy server still takes the bundled manifest over a local edit', async () => {
  const { log, status } = await statusAfterBoot({});
  assert.equal(status, target.status);
  assert.doesNotMatch(log, /canonical tracker/);
});

const CLIENT = { url: 'http://dev.example/w/acme', route: '#/table/x', viewport: { w: 1280, h: 800 }, theme: 'light', userAgent: 'test' };
const REPORT = { categories: ['error'], note: 'the save button throws', events: [], client: CLIENT };

async function fakeCanonical(handler) {
  const seen = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      handler(req, res);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, seen, base: `http://127.0.0.1:${srv.address().port}/w/weave` };
}

async function localServer() {
  const docs = seedWeaver(new Weave());
  const { server } = await startServer(new Weave(), { port: 0, workspaces: { weave: docs } });
  return { server, docs, base: `http://127.0.0.1:${server.address().port}` };
}
const file = (base, body, headers = {}) => fetch(`${base}/api/bug-report`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

test('a bug report forwards to the canonical tracker with the bearer token and names its instance', async () => {
  const canon = await fakeCanonical((req, res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'canon-id', publicId: 912, table: 'Development/Issue', workspace: 'weave', url: '/w/weave/#/entity/canon-id' }));
  });
  const local = await localServer();
  try {
    await withEnv({ WEAVE_BUG_FORWARD_URL: canon.base, WEAVE_BUG_FORWARD_TOKEN: 'wv_forwardtoken', WEAVE_ORIGIN: 'https://dev.weave.example' }, async () => {
      const before = local.docs.listEntities(local.docs.getTable('Development/Issue').id).length;
      const r = await file(local.base, REPORT);
      assert.equal(r.status, 201);
      assert.equal(r.data.id, 'canon-id');
      assert.equal(r.data.publicId, 912);
      assert.equal(r.data.forwardedTo, canon.base);
      assert.equal(canon.seen.length, 1);
      const [hit] = canon.seen;
      assert.equal(hit.method, 'POST');
      assert.equal(hit.url, '/w/weave/api/bug-report');
      assert.equal(hit.auth, 'Bearer wv_forwardtoken');
      assert.equal(hit.body.instance, 'https://dev.weave.example');
      assert.equal(hit.body.note, REPORT.note);
      assert.equal(local.docs.listEntities(local.docs.getTable('Development/Issue').id).length, before, 'nothing filed locally');
    });
  } finally { canon.srv.close(); local.server.close(); }
});

test('a failed forward files locally, says so in the response, and notes it in the report', async () => {
  const canon = await fakeCanonical((req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"down"}'); });
  const local = await localServer();
  try {
    await withEnv({ WEAVE_BUG_FORWARD_URL: canon.base, WEAVE_BUG_FORWARD_TOKEN: 'wv_forwardtoken' }, async () => {
      const r = await file(local.base, REPORT);
      assert.equal(r.status, 201);
      assert.equal(r.data.forward, 'failed');
      assert.match(r.data.forwardError, /503/);
      assert.ok(!JSON.stringify(r.data).includes('wv_forwardtoken'), 'the token never leaves in a response');
      const row = local.docs.readEntity(r.data.id);
      assert.match(row.docs.Description, new RegExp(`Forward to ${canon.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} failed: .*503`));
    });
  } finally { canon.srv.close(); local.server.close(); }
});

test('an unreachable canonical tracker falls back to a local filing', async () => {
  const canon = await fakeCanonical(() => {});
  const dead = canon.base;
  await new Promise((r) => { canon.srv.closeAllConnections?.(); canon.srv.close(r); });
  const local = await localServer();
  try {
    await withEnv({ WEAVE_BUG_FORWARD_URL: dead, WEAVE_BUG_FORWARD_TOKEN: 'wv_forwardtoken' }, async () => {
      const r = await file(local.base, REPORT);
      assert.equal(r.status, 201);
      assert.equal(r.data.forward, 'failed');
      assert.ok(local.docs.readEntity(r.data.id), 'the report is not lost');
    });
  } finally { local.server.close(); }
});

test('a canonical server never forwards, even with the forward variables set', async () => {
  const canon = await fakeCanonical((req, res) => { res.writeHead(201); res.end('{}'); });
  const local = await localServer();
  try {
    await withEnv({ WEAVE_TRACKER_CANONICAL: '1', WEAVE_BUG_FORWARD_URL: canon.base, WEAVE_BUG_FORWARD_TOKEN: 'wv_forwardtoken' }, async () => {
      const r = await file(local.base, REPORT);
      assert.equal(r.status, 201);
      assert.equal(canon.seen.length, 0);
      assert.equal(r.data.forward, undefined);
      assert.ok(local.docs.readEntity(r.data.id));
    });
  } finally { canon.srv.close(); local.server.close(); }
});

test('with the forward variables unset a report files locally exactly as before', async () => {
  const local = await localServer();
  try {
    await withEnv({}, async () => {
      const r = await file(local.base, REPORT);
      assert.equal(r.status, 201);
      assert.equal(r.data.forward, undefined);
      assert.equal(r.data.forwardedTo, undefined);
      assert.doesNotMatch(local.docs.readEntity(r.data.id).docs.Description, /Instance|Forward to/);
    });
  } finally { local.server.close(); }
});

test('the canonical tracker records the forwarding instance when an account files the report', async () => {
  const root = new Weave();
  const { token } = root.createAccount({ name: 'dev-forwarder', role: 'editor' });
  const docs = seedWeaver(new Weave());
  const { server } = await startServer(root, { port: 0, workspaces: { weave: docs } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await withEnv({ WEAVE_TRACKER_CANONICAL: '1' }, async () => {
      const signed = await file(base, { ...REPORT, instance: 'https://dev.weave.example' }, { Authorization: `Bearer ${token}` });
      assert.equal(signed.status, 201);
      assert.match(docs.readEntity(signed.data.id).docs.Description, /\| Instance \| `https:\/\/dev\.weave\.example` \|/);
      const anonymous = await file(base, { ...REPORT, instance: 'https://forged.example' });
      assert.doesNotMatch(docs.readEntity(anonymous.data.id).docs.Description, /forged\.example/, 'an anonymous page cannot claim an instance');
    });
  } finally { server.close(); }
});

test('renderBugReport names the instance and a failed forward when the server supplies them', () => {
  const plain = renderBugReport({ ...REPORT });
  assert.doesNotMatch(plain.markdown, /Instance|Forward to/);
  const md = renderBugReport({ ...REPORT, server: { instance: 'https://dev.weave.example', forwardFailure: { url: 'https://weave.example/w/weave', reason: 'answered 503' } } }).markdown;
  assert.match(md, /\| Instance \| `https:\/\/dev\.weave\.example` \|/);
  assert.match(md, /Forward to https:\/\/weave\.example\/w\/weave failed: answered 503/);
});

const run = promisify(execFile);

test('export over HTTP writes the same docs/development.json as export from the file, byte for byte', async () => {
  const sub = mkdtempSync(join(dir, 'export-'));
  const docsPath = join(sub, 'weave.db');
  const docs = seedWeaver(new Weave({ path: docsPath }));
  docs.state.meta.name = 'weave';
  syncDevelopment(docs, MANIFEST);
  const issuesT = docs.getTable('Development/Issue');
  for (const e of docs.listEntities(issuesT.id)) {
    const row = docs.readEntity(e.id);
    if (/security finding/i.test(row.name) && row.fields.Status !== 'Fixed') docs.setState(e.id, 'Status', 'Fixed');
  }
  const { token } = docs.createAccount({ name: 'exporter', role: 'observer' });
  docs.save();
  const env = { ...process.env, SOURCE_DATE_EPOCH: '1760000000', EXPORT_TOKEN: token };
  const fileOut = join(sub, 'file.json');
  const httpOut = join(sub, 'http.json');
  docs.store.close?.();
  await run('node', [EXPORT, docsPath, '--out', fileOut], { env });
  const served = new Weave({ path: docsPath });
  const { server } = await startServer(served, { port: 0 });
  try {
    await run('node', [EXPORT, '--from', `http://127.0.0.1:${server.address().port}`, '--token-env', 'EXPORT_TOKEN', '--out', httpOut], { env });
  } finally { server.close(); served.store.close?.(); }
  const a = readFileSync(fileOut, 'utf8');
  const b = readFileSync(httpOut, 'utf8');
  assert.ok(JSON.parse(a).issues.length > 100, 'the fixture is a real tracker, not an empty one');
  assert.equal(b, a);
});
