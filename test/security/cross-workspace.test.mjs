import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib/source.mjs';
import { tempDir } from '../lib/temp.mjs';

const DIR = tempDir('weave-xws-');
process.env.WEAVE_KEYSTORE = join(DIR, 'keystore.json');
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');

const ID = '00000000-0000-4000-8000-000000000000';
const TOKEN = 'nosuchtoken';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const REFUSED = [401, 403, 404];
const NEEDLE = /alpha-(row|code|doc|blob|comment|view|share|key)-needle/;
const NOT_WORKSPACE_KEYED = [/^\/api\/backups\//];
const LEAKS = [];

function listRoutes(src = readFileSync(join(ROOT, 'src/routes.js'), 'utf8')) {
  const seen = new Map();
  const add = (method, path) => seen.set(`${method} ${path}`, { method, path });
  const concretise = (re) => re
    .replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\(\?:\\\/\(\[\^\/\]\+\?\)\)\?/g, '')
    .replace(/\(\[\^\/\]\+\??\)/g, ID)
    .replace(/\(\[A-Za-z0-9_-\]\+\)/g, TOKEN)
    .replace(/\(\.\+\)/g, ID)
    .replace(/\(\\\/\.\*\|\$\)/g, '/')
    .replace(/\(([a-z]+)(?:\|[a-z]+)+\)/g, '$1')
    .replace(/\\\//g, '/').replace(/\\\./g, '.');
  for (const line of src.split('\n')) {
    const method = line.match(/rx\.method === '([A-Z]+)'/)?.[1] ?? 'GET';
    for (const [, m, p] of line.matchAll(/route === '([A-Z]+) ([^']+)'/g)) add(m, p);
    for (const [, p] of line.matchAll(/path === '([^']+)'/g)) add(method, p);
    for (const [, re] of line.matchAll(/path\.match\(\/(\^.+?\$)\/\)/g)) add(method, concretise(re));
  }
  return [...seen.values()];
}

const RESOURCE_PATHS = [...new Set(listRoutes()
  .map((r) => r.path)
  .filter((p) => (p.includes(ID) || p.includes(TOKEN)) && !NOT_WORKSPACE_KEYED.some((re) => re.test(p))))];

function build() {
  const dir = mkdtempSync(join(DIR, 'hub-'));
  const at = (name) => { const w = new Weave({ path: join(dir, `${name}.db`), keystorePath: join(dir, 'keystore.json') }); w.updateWorkspace({ name }); return w; };
  const root = at('root');
  root.createAccount({ name: 'root-architect', role: 'architect' });
  const alpha = at('alpha');
  const beta = at('beta');
  const a = {};
  a.architect = alpha.createAccount({ name: 'alpha-architect', role: 'architect' });
  alpha.actor = `account:${a.architect.account.id}`;
  a.space = alpha.createSpace({ name: 'Vault' });
  a.table = alpha.createTable({ space: 'Vault', name: 'Secret' });
  a.field = alpha.addField(a.table.id, { name: 'Code', type: 'text' });
  a.entity = alpha.createEntity(a.table.id, { name: 'alpha-row-needle', values: { Code: 'alpha-code-needle' } });
  alpha.setDoc(a.entity.id, 'alpha-doc-needle');
  a.blob = alpha.attachFile(a.entity.id, { name: 'alpha.txt', mime: 'text/plain', bytes: Buffer.from('alpha-blob-needle') });
  a.comment = alpha.addComment(a.entity.id, { author: 'alpha-architect', text: 'alpha-comment-needle' });
  a.view = alpha.createView({ name: 'alpha-view-needle', blocks: [{ table: 'Secret' }] });
  a.tableView = alpha.tableView({ id: a.table.id }).views[0];
  a.share = alpha.mintShare({ scope: { kind: 'table', id: a.table.id }, mode: 'manage', label: 'alpha-share-needle' });
  alpha.setKey('ALPHA_KEY', 'alpha-key-needle');
  alpha.setRequireAuth(true);
  beta.createSpace({ name: 'Home' });
  beta.createTable({ space: 'Home', name: 'Note' });
  const b = {};
  b.editor = beta.createAccount({ name: 'beta-editor', role: 'editor' }).token;
  b.session = beta.createSession('beta-editor').token;
  beta.setRequireAuth(true);
  const hub = createWorkspaceHub(root, { workspaces: { alpha, beta } });
  const ids = {
    entities: a.entity.id, e: a.entity.id, tables: a.table.id, t: a.table.id, fields: a.field.id, files: a.blob.id,
    views: a.view.id, shares: a.share.id, keys: 'ALPHA_KEY', spaces: a.space.id, accounts: a.architect.account.id,
    comments: a.comment.id, workspaces: 'alpha', activity: a.entity.id, forms: a.table.id, f: a.table.id,
  };
  const fill = (path) => {
    const seg = path.split('/');
    return seg.map((x, i) => {
      if (x === TOKEN) return a.share.token;
      if (x !== ID) return x;
      if (seg[i - 1] === 'views' && seg[i - 3] === 'tables') return a.tableView.id;
      return ids[seg[i - 1]] ?? a.entity.id;
    }).join('/');
  };
  const body = () => ({
    Name: 'beta-wrote', Code: 'beta-wrote', name: 'beta-wrote', text: 'beta-wrote', doc: 'beta-wrote', markdown: 'beta-wrote',
    workspace: 'beta', account: 'beta-editor', value: 'beta-wrote', operation: 'append', expectedRevision: alpha.entityRevision(a.entity.id),
  });
  const footprint = () => JSON.stringify({
    audit: alpha.listAudit({ limit: 100000 }).length,
    entities: alpha.state.entities, tables: alpha.state.tables, spaces: alpha.state.spaces,
    views: alpha.state.meta.views, shares: alpha.state.meta.shares, keys: alpha.listKeys(), deletedAt: alpha.state.meta.deletedAt ?? null,
  });
  return { hub, alpha, beta, a, b, fill, body, footprint, call: client(hub) };
}

const leakKey = (method, path) => `${method} ${path}`;
const excluded = (method, path) => LEAKS.some((l) => l.key === leakKey(method, path));

test('the probe list is derived from the dispatcher and names every resource route the brief lists', () => {
  for (const p of [`/api/entities/${ID}`, `/api/files/${ID}`, `/api/tables/${ID}`, `/api/tables/${ID}/query`, `/api/tables/${ID}/entities`,
    `/api/views/${ID}`, `/api/views/${ID}/share`, `/api/shares/${ID}`, `/api/keys/${ID}`, `/api/keys/${ID}/share`, `/api/entities/${ID}/doc`, `/view/${TOKEN}`, `/e/${ID}/doc.md`]) {
    assert.ok(RESOURCE_PATHS.includes(p), `the derived probe list lacks ${p}`);
  }
  assert.ok(RESOURCE_PATHS.length > 60, `only ${RESOURCE_PATHS.length} resource routes derived`);
  for (const l of LEAKS) assert.match(l.issue, /^#\d+$/, `${l.key} is excluded only with its Issue row`);
});

for (const [who, cred] of [['token', (b) => ({ token: b.editor })], ['session', (b) => ({ cookie: b.session })]]) {
  test(`workspace B's editor ${who}, on B's base path, opens and changes none of A's resources on any derived route and method`, async () => {
    const { b, fill, body, footprint, call } = build();
    const before = footprint();
    let probed = 0;
    for (const path of RESOURCE_PATHS) {
      for (const method of METHODS) {
        const url = `/w/beta${fill(path)}`;
        if (excluded(method, path)) continue;
        const res = await call(method, url, { ...cred(b), body: body() });
        const text = JSON.stringify(res.json) ?? '';
        assert.ok(REFUSED.includes(res.status), `${method} ${url} answered ${res.status}: ${text.slice(0, 200)}`);
        assert.ok(!NEEDLE.test(text), `${method} ${url} carried A's data: ${text.slice(0, 200)}`);
        probed += 1;
      }
    }
    assert.equal(footprint(), before, "A's audit log, rows, schema, views, shares and keys are untouched");
    assert.equal(probed, RESOURCE_PATHS.length * METHODS.length - LEAKS.length);
  });
}

test("A's share token and A's account token open nothing under B, and B's credentials open nothing under A", async () => {
  const { a, b, footprint, call } = build();
  const before = footprint();
  const t = a.share.token;
  const cases = [
    ['GET', `/w/beta/s/${t}`, {}, 404],
    ['GET', `/w/beta/s/${t}/table/${a.table.id}`, {}, 404],
    ['GET', `/w/beta/s/${t}/e/${a.entity.id}/entity.html`, {}, 404],
    ['GET', `/w/beta/s/${t}/view/${a.view.id}`, {}, 404],
    ['GET', `/w/beta/view/${t}`, {}, 404],
    ['GET', '/w/beta/api/share', { token: t }, 401],
    ['GET', `/w/beta/api/entities/${a.entity.id}`, { token: t }, 401],
    ['PATCH', `/w/beta/api/entities/${a.entity.id}`, { token: t }, 401],
    ['POST', `/w/beta/api/tables/${a.table.id}/query`, { token: t }, 401],
    ['POST', `/w/beta/api/tables/${a.table.id}/entities`, { token: t }, 401],
    ['DELETE', `/w/beta/api/entities/${a.entity.id}`, { token: t }, 401],
    ['GET', `/w/beta/api/files/${a.blob.id}`, { token: t }, 401],
    ['GET', `/w/beta/api/entities/${a.entity.id}`, { token: a.architect.token }, 401],
    ['PATCH', `/w/beta/api/entities/${a.entity.id}`, { token: a.architect.token }, 401],
    ['GET', '/w/beta/api/keys', { token: a.architect.token }, 401],
    ['GET', '/w/beta/api/keys/ALPHA_KEY/share', { token: a.architect.token }, 401],
    ['POST', '/w/beta/api/keys/ALPHA_KEY/reveal', { token: a.architect.token }, 401],
    ['GET', `/w/alpha/api/entities/${a.entity.id}`, { token: b.editor }, 401],
    ['PATCH', `/w/alpha/api/entities/${a.entity.id}`, { token: b.editor }, 401],
    ['GET', `/w/alpha/api/entities/${a.entity.id}`, { cookie: b.session }, 401],
    ['GET', `/w/alpha/api/files/${a.blob.id}`, { token: b.editor }, 401],
    ['POST', `/w/alpha/api/tables/${a.table.id}/query`, { token: b.editor }, 401],
    ['GET', `/w/alpha/api/views/${a.view.id}`, { token: b.editor }, 401],
  ];
  for (const [method, url, cred, status] of cases) {
    const res = await call(method, url, { ...cred, body: { Name: 'beta-wrote', Code: 'beta-wrote' } });
    const text = JSON.stringify(res.json) ?? '';
    assert.equal(res.status, status, `${method} ${url}: ${text.slice(0, 200)}`);
    assert.ok(!NEEDLE.test(text), `${method} ${url} carried A's data`);
  }
  assert.equal(footprint(), before, "A's audit log and state are untouched");
});
