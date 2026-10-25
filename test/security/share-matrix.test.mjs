import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';
import { SHARE_KINDS, SHARE_MODES } from '../../src/shares.js';
import { read } from '../lib/source.mjs';

const RUNG = Object.fromEntries([...read('src/shares.js').match(/const RUNG = \{([^}]+)\}/)[1].matchAll(/(\w+): (\d+)/g)].map(([, m, n]) => [m, Number(n)]));
const LANDING = { entity: (s) => `/e/${s.one.id}/entity.html`, table: (s) => `/table/${s.task.id}`, space: (s) => `/space/${s.dev.id}`, view: (s) => `/view/${s.view.id}`, workspace: () => '/workspace' };
const SCOPE_ID = { entity: (s) => s.one.id, table: (s) => s.task.id, space: (s) => s.dev.id, view: (s) => s.view.id, workspace: (s) => s.w.state.meta.id };
const NARROW = new Set(['entity', 'view']);
const OUTSIDE = 'A share link reaches the rows, documents and files in its scope, nothing else';

function seed() {
  const w = new Weave();
  const dev = w.createSpace({ name: 'Dev' });
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  const job = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(task.id, { name: 'Owner', type: 'text' });
  const one = w.createEntity(task.id, { name: 'One', values: { Owner: 'ann' } });
  const two = w.createEntity(task.id, { name: 'Two', values: { Owner: 'dana' } });
  const deploy = w.createEntity(job.id, { name: 'Deploy' });
  w.setDoc(one.id, 'Shared doc body');
  const view = w.createView({ name: 'Focus', blocks: [{ table: 'Task', where: [['Name', '=', 'One']] }] });
  return { w, dev, task, job, one, two, deploy, view };
}

async function serve() {
  const s = seed();
  s.w.createAccount({ name: 'root', role: 'architect' });
  s.w.createAccount({ name: 'eye', role: 'observer' });
  s.w.setRequireAuth(true);
  const { server } = await startServer(s.w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  s.call = (method, path, { token, body, cookie } = {}) => fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  s.grant = (kind, mode, extra = {}) => {
    const g = s.w.mintShare({ scope: { kind, id: SCOPE_ID[kind](s) }, mode: mode === 'comment' ? 'read' : mode, ...extra });
    s.w.state.meta.shares[g.id].mode = mode;
    return s.w.shareByToken(g.token);
  };
  s.snapshot = () => JSON.stringify({ entities: s.w.state.entities, audit: s.w.listAudit({ limit: 100000 }).length });
  s.stop = () => server.close();
  return s;
}

const json = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const names = (body) => (body?.items ?? []).map((x) => x.name).sort();

function probes(kind, mode) {
  const rung = RUNG[mode];
  const inScope = NARROW.has(kind) ? ['One'] : ['One', 'Two'];
  const refused = (error) => ({ status: 403, error });
  return [
    { name: 'GET the landing page', method: 'GET', path: (s, g) => `/s/${g.token}`, expect: { status: 302 }, check: (s, g, res) => assert.equal(res.headers.get('location'), `/s/${g.token}${LANDING[kind](s)}`) },
    { name: 'GET the scope page', method: 'GET', path: (s, g) => `/s/${g.token}${LANDING[kind](s)}`, expect: { status: 200 } },
    { name: 'GET the row page', method: 'GET', path: (s, g) => `/s/${g.token}/e/${s.one.id}/entity.html`, expect: { status: 200 }, check: async (s, g, res) => assert.match(await res.text(), /Shared doc body/) },
    { name: 'POST at a page', method: 'POST', path: (s, g) => `/s/${g.token}/e/${s.one.id}/doc.md`, expect: { status: 405, error: 'A share page is read-only' }, write: true },
    { name: 'GET /api/share', method: 'GET', path: () => '/api/share', expect: { status: 200 }, check: async (s, g, res) => assert.deepEqual([(await res.json()).mode, g.scope.kind], [mode, kind]) },
    { name: 'GET the row', method: 'GET', path: (s) => `/api/entities/${s.one.id}`, expect: { status: 200 }, check: async (s, g, res) => assert.equal((await res.json()).fields.Name, 'One') },
    { name: 'GET the row doc', method: 'GET', path: (s) => `/api/entities/${s.one.id}/doc`, expect: { status: 200 } },
    { name: 'GET the table rows', method: 'GET', path: (s) => `/api/tables/${s.task.id}/entities`, expect: { status: 200 }, check: async (s, g, res) => assert.deepEqual(names(await res.json()), inScope) },
    { name: 'POST a table query', method: 'POST', path: (s) => `/api/tables/${s.task.id}/query`, body: {}, expect: { status: 200 }, check: async (s, g, res) => assert.deepEqual(names(await res.json()), inScope) },
    { name: 'GET a row in another space', method: 'GET', path: (s) => `/api/entities/${s.deploy.id}`, expect: kind === 'workspace' ? { status: 200 } : { status: 404, error: 'Not found' } },
    { name: 'GET outside the share door', method: 'GET', path: () => '/api/schema', expect: refused(OUTSIDE) },
    { name: 'POST a comment', method: 'POST', path: (s) => `/api/entities/${s.one.id}/comments`, body: { text: 'by share' }, expect: refused('Comments by share link are not built yet'), write: true },
    {
      name: 'PATCH the row', method: 'PATCH', path: (s) => `/api/entities/${s.one.id}`, body: { Owner: `patched by ${mode}` }, write: true,
      expect: rung >= RUNG.edit ? { status: 200 } : refused(`A ${mode} link cannot change rows; that takes edit`),
      effect: (s) => assert.equal(s.w.readEntity(s.one.id).fields.Owner, `patched by ${mode}`),
    },
    {
      name: 'POST a row', method: 'POST', path: (s) => `/api/tables/${s.task.id}/entities`, body: { Name: `made by ${mode}` }, write: true,
      expect: kind === 'entity' ? refused('This share link reaches one row; it cannot add rows beside it')
        : rung >= RUNG.manage ? { status: 201 } : refused(`A ${mode} link cannot add rows; that takes manage`),
      effect: (s) => assert.ok(s.w.listEntities(s.task.id).some((e) => s.w.entityName(e) === `made by ${mode}`)),
    },
    {
      name: 'DELETE the row', method: 'DELETE', path: (s) => `/api/entities/${s.one.id}`, write: true,
      expect: rung >= RUNG.manage ? { status: 200 } : refused(`A ${mode} link cannot delete rows; that takes manage`),
      effect: (s) => assert.ok(s.w.getEntity(s.one.id).deletedAt),
    },
  ];
}

const MATRIX = SHARE_MODES.flatMap((mode) => SHARE_KINDS.map((kind) => ({ mode, kind, probes: probes(kind, mode) })));

test('the matrix is generated from the rungs and scope kinds src/shares.js declares', () => {
  assert.deepEqual(Object.keys(RUNG), SHARE_MODES, 'every mode has a rung, in ladder order');
  assert.deepEqual(Object.values(RUNG), SHARE_MODES.map((_, i) => i));
  assert.deepEqual(Object.keys(LANDING).sort(), [...SHARE_KINDS].sort());
  assert.equal(MATRIX.length, SHARE_MODES.length * SHARE_KINDS.length);
  assert.equal(MATRIX.reduce((n, c) => n + c.probes.length, 0), 300, 'cells asserted through the share door');
});

for (const { mode, kind, probes: cells } of MATRIX) {
  test(`share door matrix: a ${mode} link on a ${kind} answers every method by its rung`, async () => {
    const s = await serve();
    try {
      const g = s.grant(kind, mode);
      for (const p of cells) {
        const label = `${mode} × ${kind} × ${p.name}`;
        const before = s.snapshot();
        const res = await s.call(p.method, p.path(s, g), { token: p.path(s, g).startsWith('/s/') ? undefined : g.token, body: p.body });
        assert.equal(res.status, p.expect.status, `${label}: ${res.status} ${JSON.stringify(await json(res))}`);
        if (p.expect.error) assert.equal((await json(res))?.error, p.expect.error, label);
        if (p.check) await p.check(s, g, res);
        if (!p.write) continue;
        if (p.expect.status >= 400) assert.equal(s.snapshot(), before, `${label}: a refused write changed nothing`);
        else p.effect(s);
      }
    } finally {
      s.stop();
    }
  });
}

const DEAD = [
  { name: 'expired', end: (s, g) => { s.w.state.meta.shares[g.id].expiresAt = new Date(Date.now() - 1000).toISOString(); }, page: 404, api: 401, error: 'Invalid token' },
  { name: 'revoked', end: (s, g) => { s.w.revokeShare(g.id); }, page: 404, api: 401, error: 'Invalid token' },
  { name: 'private', end: () => {}, extra: { visibility: 'private' }, page: 401, api: 401, error: 'This share link is private: sign in to open it' },
];

for (const row of DEAD) {
  test(`share door matrix: an ${row.name} edit link opens nothing and writes nothing`, async () => {
    const s = await serve();
    try {
      const g = s.grant('table', 'edit', row.extra);
      row.end(s, g);
      const before = s.snapshot();
      assert.equal((await s.call('GET', `/s/${g.token}/table/${s.task.id}`)).status, row.page, `${row.name}: the page`);
      for (const [method, path, body] of [['GET', `/api/entities/${s.one.id}`], ['PATCH', `/api/entities/${s.one.id}`, { Owner: 'ghost' }], ['DELETE', `/api/entities/${s.one.id}`]]) {
        const res = await s.call(method, path, { token: g.token, body });
        assert.equal(res.status, row.api, `${row.name}: ${method} ${path}`);
        assert.equal((await res.json()).error, row.error);
      }
      assert.equal(s.snapshot(), before, `${row.name}: nothing changed`);
      if (row.name !== 'private') return;
      const cookie = `wv_session_${s.w.state.meta.id}=${s.w.createSession('eye').token}`;
      assert.equal((await s.call('PATCH', `/api/entities/${s.one.id}`, { token: g.token, cookie, body: { Owner: 'signed in' } })).status, 200);
      assert.equal(s.w.readEntity(s.one.id).fields.Owner, 'signed in', 'a signed-in viewer writes through a private edit link');
    } finally {
      s.stop();
    }
  });
}

test('the shared table page renders a many-relation cell as names joined by ", " and a one-relation cell by its name', async () => {
  const s = await serve();
  try {
    const tag = s.w.createTable({ space: 'Dev', name: 'Tag' });
    const person = s.w.createTable({ space: 'Dev', name: 'Person' });
    s.w.addRelation(s.task.id, { name: 'Tags', targetDb: tag.id, cardinality: 'many-to-many' });
    s.w.addRelation(s.task.id, { name: 'Lead', targetDb: person.id, cardinality: 'many-to-one' });
    const tags = ['Alpha', 'Beta'].map((name) => s.w.createEntity(tag.id, { name }).id);
    const lead = s.w.createEntity(person.id, { name: 'Dana' }).id;
    s.w.updateEntity(s.one.id, { Tags: tags, Lead: lead });
    const g = s.grant('table', 'read');
    const html = await (await s.call('GET', `/s/${g.token}/table/${s.task.id}`)).text();
    assert.match(html, /<th>Tags<\/th><th>Lead<\/th>/);
    assert.match(html, /<td>Alpha, Beta<\/td><td>Dana<\/td>/, 'each related row by its name');
    assert.ok(!html.includes('[object Object]'), 'no relation cell prints the raw object');
  } finally {
    s.stop();
  }
});
