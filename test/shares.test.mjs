import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';
import { withinScope, SHARE_KINDS, SHARE_MODES, SHARE_VISIBILITIES } from '../src/shares.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  const bug = w.createTable({ space: 'Dev', name: 'Bug' });
  const job = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(task.id, { name: 'Owner', type: 'text' });
  const one = w.createEntity(task.id, { name: 'One' });
  const two = w.createEntity(task.id, { name: 'Two', values: { Owner: 'dana' } });
  const crash = w.createEntity(bug.id, { name: 'Crash' });
  const deploy = w.createEntity(job.id, { name: 'Deploy' });
  w.setDoc(one.id, 'Shared doc body, naming [[Task#2]] and [[Bug#1]].');
  return { w, task, bug, job, one, two, crash, deploy };
}

const registryRow = (w) => {
  const sys = w.listTables().find((d) => d.system && w.listEntities(d.id).length);
  return w.listEntities(sys.id)[0];
};

test('a grant has the ruled shape, a wvs_ token kept in plaintext, and a /s/ link', () => {
  const { w, one } = seed();
  w.actor = 'kyle';
  const g = w.mintShare({ scope: { kind: 'entity', id: one.id }, label: 'For the vendor' });
  assert.match(g.token, /^wvs_[\w-]{24,}$/);
  assert.deepEqual(g.scope, { kind: 'entity', id: one.id });
  assert.equal(g.mode, 'read');
  assert.equal(g.visibility, 'public');
  assert.equal(g.label, 'For the vendor');
  assert.equal(g.createdBy, 'kyle');
  assert.ok(!Number.isNaN(Date.parse(g.createdAt)));
  assert.equal(g.expiresAt, null);
  assert.equal(g.revokedAt, null);
  assert.equal(g.url, `/s/${g.token}`);
  assert.equal(w.state.meta.shares[g.id].token, g.token, 'stored in plaintext so the dialog can show the link again');
  assert.equal(w.shareByToken(g.token).id, g.id);
  assert.equal(w.listShares().length, 1);
  assert.equal(w.listShares({ kind: 'entity', id: one.id })[0].token, g.token);
  assert.equal(w.listShares({ kind: 'table', id: one.dbId }).length, 0);
});

test('the enums are the ruled ones, and a bad grant is refused before it is stored', () => {
  const { w, one, task } = seed();
  assert.deepEqual(SHARE_KINDS, ['entity', 'table', 'space', 'view', 'workspace']);
  assert.deepEqual(SHARE_MODES, ['read', 'comment', 'edit', 'manage']);
  assert.deepEqual(SHARE_VISIBILITIES, ['public', 'private']);
  const scope = { kind: 'entity', id: one.id };
  assert.throws(() => w.mintShare({ scope: { kind: 'document', id: one.id } }), { code: 'invalid' });
  assert.throws(() => w.mintShare({ scope, mode: 'admin' }), { code: 'invalid' });
  assert.throws(() => w.mintShare({ scope, visibility: 'secret' }), { code: 'invalid' });
  assert.throws(() => w.mintShare({ scope, mode: 'comment' }), { code: 'forbidden' }, 'comment waits for comments-by-share');
  assert.throws(() => w.mintShare({ scope: { kind: 'entity', id: '00000000-0000-4000-8000-000000000000' } }), { code: 'not-found' });
  assert.throws(() => w.mintShare({ scope: { kind: 'table', id: registryRow(w).dbId } }), { code: 'invalid' }, 'the registry is not shareable');
  assert.throws(() => w.mintShare({ scope, expiresAt: '2001-01-01T00:00:00Z' }), { code: 'invalid' });
  assert.throws(() => w.mintShare({ scope: { kind: 'entity', id: '__proto__' } }), { code: 'not-found' });
  assert.equal(Object.keys(w.state.meta.shares ?? {}).length, 0);
  assert.equal(w.mintShare({ scope: { kind: 'table', id: 'Dev/Task' } }).scope.id, task.id, 'a table is named the way every verb names it');
});

test('expiry and revocation end a grant, and revoking twice is harmless', () => {
  const { w, one } = seed();
  const later = new Date(Date.now() + 86400000).toISOString();
  const g = w.mintShare({ scope: { kind: 'entity', id: one.id }, expiresAt: later });
  assert.equal(w.shareByToken(g.token).expiresAt, later);
  w.state.meta.shares[g.id].expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(w.shareByToken(g.token), null, 'an expired link resolves to nothing');
  const h = w.mintShare({ scope: { kind: 'entity', id: one.id } });
  const gone = w.revokeShare(h.id);
  assert.ok(gone.revokedAt);
  assert.equal(w.shareByToken(h.token), null);
  assert.equal(w.revokeShare(h.id).revokedAt, gone.revokedAt);
  assert.equal(w.listShares().length, 0, 'the list holds live grants only');
  assert.throws(() => w.revokeShare('nope'), { code: 'not-found' });
  w.deleteEntity(one.id);
  const k = w.mintShare({ scope: { kind: 'table', id: one.dbId } });
  assert.ok(w.shareByToken(k.token));
  w.deleteTable(one.dbId);
  assert.equal(w.shareByToken(k.token), null, 'a grant on a trashed table opens nothing');
});

test('withinScope is the one containment test, and it only ever narrows', () => {
  const { w, task, bug, one, two, crash, deploy } = seed();
  const dev = w.findSpace('Dev');
  const view = w.createView({ name: 'Only one', blocks: [{ table: 'Task', where: [['Name', '=', 'One']] }] });
  const grant = (kind, id) => ({ scope: { kind, id }, mode: 'read' });
  const sys = registryRow(w);
  const cases = [
    [grant('entity', one.id), { entityId: one.id }, true],
    [grant('entity', one.id), { entityId: two.id }, false],
    [grant('entity', one.id), { tableId: task.id }, false],
    [grant('table', task.id), { entityId: two.id }, true],
    [grant('table', task.id), { entityId: crash.id }, false],
    [grant('table', task.id), { tableId: task.id }, true],
    [grant('table', task.id), { tableId: bug.id }, false],
    [grant('table', task.id), { spaceId: dev.id }, false],
    [grant('space', dev.id), { entityId: crash.id }, true],
    [grant('space', dev.id), { entityId: deploy.id }, false],
    [grant('space', dev.id), { tableId: bug.id }, true],
    [grant('space', dev.id), { spaceId: dev.id }, true],
    [grant('view', view.id), { viewId: view.id }, true],
    [grant('view', view.id), { entityId: one.id }, true],
    [grant('view', view.id), { entityId: two.id }, false],
    [grant('view', view.id), { entityId: crash.id }, false],
    [grant('workspace', w.state.meta.id), { entityId: deploy.id }, true],
    [grant('workspace', w.state.meta.id), { entityId: sys.id }, false],
    [grant('table', task.id), {}, false],
    [grant('table', task.id), { entityId: '__proto__' }, false],
  ];
  for (const [g, target, want] of cases) {
    assert.equal(withinScope(w, g, target), want, `${g.scope.kind} grant, target ${JSON.stringify(target)}`);
  }
  w.deleteEntity(two.id);
  assert.equal(withinScope(w, grant('table', task.id), { entityId: two.id }), false, 'a trashed row is outside every scope');
});

test('mint and revoke land in the audit log with their actor, and the token never does', () => {
  const { w, one } = seed();
  w.actor = 'dana';
  const g = w.mintShare({ scope: { kind: 'entity', id: one.id }, label: 'Vendor' });
  w.revokeShare(g.id);
  const rows = w.listAudit({ limit: 10 }).filter((r) => r.action.startsWith('share-'));
  assert.deepEqual(rows.map((r) => r.action).sort(), ['share-minted', 'share-revoked']);
  for (const r of rows) assert.equal(r.actor, 'dana');
  assert.ok(!JSON.stringify(w.listAudit({ limit: 50 })).includes(g.token));
});

test('an export carries no share token; an import back into the same workspace keeps the link', () => {
  const { w, one } = seed();
  const g = w.mintShare({ scope: { kind: 'entity', id: one.id } });
  const text = JSON.stringify(w.exportJSON());
  assert.ok(!text.includes(g.token));
  assert.ok(!/\bwvs_[\w-]{16,}/.test(text));
  assert.ok(text.includes(g.id), 'the grant itself travels');
  w.importJSON(JSON.parse(text));
  assert.equal(w.shareByToken(g.token)?.id, g.id);
  const far = new Weave();
  far.importJSON(JSON.parse(text));
  assert.equal(far.shareByToken(g.token), null);
  assert.equal(far.listShares().length, 0, 'a grant without its token is not a link');
});

test('a view share is a grant; an old shareToken lifts into one on open and keeps its link', () => {
  const { w, one } = seed();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  const { url, token } = w.shareView(v.id);
  assert.match(token, /^wvs_/);
  assert.equal(url, `/s/${token}`);
  assert.equal(w.shareView(v.id).token, token, 'sharing twice hands back the same link');
  assert.equal(w.listViews()[0].shared, true);
  assert.equal(w.listShares({ kind: 'view', id: v.id })[0].mode, 'read');
  w.unshareView(v.id);
  assert.equal(w.listViews()[0].shared, false);
  assert.equal(w.viewByShareToken(token), null);

  const dir = mkdtempSync(join(tmpdir(), 'weave-shares-'));
  try {
    const path = join(dir, 'ws.db');
    const a = new Weave({ path });
    a.createSpace({ name: 'Dev' });
    a.createTable({ space: 'Dev', name: 'Task' });
    const old = a.createView({ name: 'Board', blocks: [{ table: 'Task' }] });
    const legacy = 'wvv_' + 'L'.repeat(24);
    a.state.meta.views[old.id].shareToken = legacy;
    a.save();
    a.close?.();
    const b = new Weave({ path });
    assert.equal(b.state.meta.views[old.id].shareToken, undefined, 'the view no longer holds a token');
    const lifted = b.listShares({ kind: 'view', id: old.id });
    assert.equal(lifted.length, 1);
    assert.deepEqual([lifted[0].token, lifted[0].mode, lifted[0].visibility], [legacy, 'read', 'public']);
    assert.equal(b.viewByShareToken(legacy).id, old.id);
    assert.equal(b.listViews()[0].shared, true);
    b.close?.();
    assert.equal(new Weave({ path }).listShares().length, 1, 'lifting twice makes one grant');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(one);
});

async function serve({ requireAuth = true } = {}) {
  const s = seed();
  const { w } = s;
  s.architect = w.createAccount({ name: 'root', role: 'architect' }).token;
  s.editor = w.createAccount({ name: 'bot', role: 'editor' }).token;
  s.observer = w.createAccount({ name: 'eye', role: 'observer' }).token;
  w.setRequireAuth(requireAuth);
  const { server } = await startServer(w, { port: 0 });
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
  s.mint = (scope, extra = {}) => w.mintShare({ scope, ...extra });
  s.stop = () => server.close();
  return s;
}

for (const requireAuth of [true, false]) {
  test(`a public entity link reads that entity and answers 404 beside it (requireAuth ${requireAuth ? 'on' : 'off'})`, async () => {
    const { one, two, call, mint, stop } = await serve({ requireAuth });
    try {
      const g = mint({ kind: 'entity', id: one.id });
      const land = await call('GET', `/s/${g.token}`);
      assert.equal(land.status, 302);
      assert.equal(land.headers.get('location'), `/s/${g.token}/e/${one.id}/entity.html`);
      const page = await call('GET', `/s/${g.token}/e/${one.id}/entity.html`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /One/);
      assert.match(html, /Shared doc body/);
      for (const p of [`/e/${two.id}/entity.html`, `/e/${two.id}/doc.html`, `/table/${one.dbId}`, `/space/x`, '/workspace', '/nonsense']) {
        assert.equal((await call('GET', `/s/${g.token}${p}`)).status, 404, `${p} is outside an entity grant`);
      }
      for (const tail of ['doc.html', 'doc.md', 'entity.md', 'entity.pdf']) {
        assert.equal((await call('GET', `/s/${g.token}/e/${one.id}/${tail}`)).status, 200, tail);
      }
      assert.equal((await call('POST', `/s/${g.token}/e/${one.id}/doc.md`)).status, 405, 'a share page is read-only in v1');
      assert.equal((await call('GET', `/s/wvs_${'x'.repeat(30)}`)).status, 404);
      if (requireAuth) assert.equal((await call('GET', `/e/${one.id}/doc.html`)).status, 401, 'the plain page stays walled');
    } finally {
      stop();
    }
  });
}

test('mentions inside a shared document resolve only inside the scope', async () => {
  const { one, two, crash, call, mint, stop } = await serve();
  try {
    const g = mint({ kind: 'entity', id: one.id });
    const html = await (await call('GET', `/s/${g.token}/e/${one.id}/doc.html`)).text();
    assert.ok(!html.includes(two.id), 'no link to a row outside the grant');
    assert.ok(!html.includes(crash.id));
    assert.ok(!html.includes('>Two<') && !html.includes('Crash'), 'no name of a row outside the grant');
    const t = mint({ kind: 'table', id: one.dbId });
    const wide = await (await call('GET', `/s/${t.token}/e/${one.id}/doc.html`)).text();
    assert.ok(wide.includes(`/s/${t.token}/e/${two.id}/doc.html`), 'a row inside the grant links through the same share');
    assert.ok(!wide.includes(crash.id));
  } finally {
    stop();
  }
});

test('table, space, view and workspace pages render from the schema, inside their scope', async () => {
  const { w, task, bug, job, call, mint, stop } = await serve();
  try {
    const t = mint({ kind: 'table', id: task.id });
    assert.equal((await call('GET', `/s/${t.token}`)).headers.get('location'), `/s/${t.token}/table/${task.id}`);
    const tableHtml = await (await call('GET', `/s/${t.token}/table/${task.id}`)).text();
    assert.match(tableHtml, /One/);
    assert.match(tableHtml, /Two/);
    assert.match(tableHtml, /<th>Owner<\/th>/, 'columns come from the schema, not from the first row');
    assert.ok(!tableHtml.includes('Crash'));
    assert.equal((await call('GET', `/s/${t.token}/table/${bug.id}`)).status, 404);

    const dev = w.findSpace('Dev');
    const s = mint({ kind: 'space', id: dev.id });
    const spaceHtml = await (await call('GET', `/s/${s.token}/space/${dev.id}`)).text();
    assert.ok(spaceHtml.includes(`/s/${s.token}/table/${task.id}`) && spaceHtml.includes(`/s/${s.token}/table/${bug.id}`));
    assert.ok(!spaceHtml.includes(job.id));
    assert.equal((await call('GET', `/s/${s.token}/table/${bug.id}`)).status, 200);
    assert.equal((await call('GET', `/s/${s.token}/table/${job.id}`)).status, 404);

    const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task', where: [['Name', '=', 'One']] }] });
    const vs = mint({ kind: 'view', id: v.id });
    const viewHtml = await (await call('GET', `/s/${vs.token}/view/${v.id}`)).text();
    assert.match(viewHtml, /Focus/);
    assert.match(viewHtml, /One/);
    assert.ok(!viewHtml.includes('Two'), 'the where clause holds');

    const ws = mint({ kind: 'workspace', id: w.state.meta.id });
    const wsHtml = await (await call('GET', `/s/${ws.token}/workspace`)).text();
    assert.ok(wsHtml.includes(`/s/${ws.token}/space/${dev.id}`));
    assert.ok(!/Workspace\/Tables|>Workspace</.test(wsHtml), 'the registry space is not listed');
  } finally {
    stop();
  }
});

test('a Bearer wvs_ token reads the scoped JSON API and nothing else', async () => {
  const { w, task, bug, one, two, crash, call, mint, stop } = await serve();
  try {
    const t = mint({ kind: 'table', id: task.id }, { label: 'agent' });
    const me = await call('GET', '/api/share', { token: t.token });
    assert.equal(me.status, 200);
    const resolved = await me.json();
    assert.deepEqual([resolved.scope.kind, resolved.scope.id, resolved.mode], ['table', task.id, 'read']);
    assert.equal(resolved.token, undefined, 'resolving a token does not echo it');
    assert.equal((await call('GET', `/api/entities/${one.id}`, { token: t.token })).status, 200);
    assert.equal((await call('GET', `/api/entities/${crash.id}`, { token: t.token })).status, 404);
    const q = await (await call('POST', `/api/tables/${task.id}/query`, { token: t.token, body: {} })).json();
    assert.deepEqual(q.items.map((e) => e.name).sort(), ['One', 'Two']);
    assert.equal((await call('POST', `/api/tables/${bug.id}/query`, { token: t.token, body: {} })).status, 404);
    const tables = await (await call('GET', '/api/tables', { token: t.token })).json();
    assert.deepEqual(tables.map((d) => d.id), [task.id]);
    for (const [m, p] of [['GET', '/api/schema'], ['GET', '/api/export'], ['GET', '/api/accounts'], ['GET', '/api/shares'], ['POST', '/api/mcp'], ['GET', '/api/search?q=Crash']]) {
      assert.equal((await call(m, p, { token: t.token })).status, 403, `${m} ${p}`);
    }
    assert.equal((await call('PATCH', `/api/entities/${one.id}`, { token: t.token, body: { Name: 'x' } })).status, 403, 'read cannot write');

    const e = mint({ kind: 'entity', id: one.id });
    const only = await (await call('POST', `/api/tables/${task.id}/query`, { token: e.token, body: {} })).json();
    assert.deepEqual(only.items.map((x) => x.name), ['One']);
    assert.equal(only.total, 1);
    assert.equal((await call('GET', `/api/entities/${two.id}/doc`, { token: e.token })).status, 404);
    assert.equal((await call('GET', `/api/entities/${one.id}/doc`, { token: e.token })).status, 200);

    assert.equal((await call('GET', '/api/share', { token: `wvs_${'z'.repeat(30)}` })).status, 401);
    w.revokeShare(t.id);
    assert.equal((await call('GET', `/api/entities/${one.id}`, { token: t.token })).status, 401, 'a revoked token is refused');
    assert.equal((await call('GET', `/s/${t.token}`)).status, 404, 'a revoked link is a miss');
  } finally {
    stop();
  }
});

test('the mode ladder: edit updates in scope, manage adds create and delete, neither reaches schema or the registry', async () => {
  const { w, task, one, two, crash, call, mint, stop } = await serve();
  try {
    const sys = registryRow(w);
    const edit = mint({ kind: 'table', id: task.id }, { mode: 'edit' });
    assert.equal((await call('PATCH', `/api/entities/${one.id}`, { token: edit.token, body: { Owner: 'kim' } })).status, 200);
    assert.equal(w.readEntity(one.id).fields.Owner, 'kim');
    assert.equal((await call('PUT', `/api/entities/${one.id}/doc`, { token: edit.token, body: { doc: 'rewritten' } })).status, 200);
    assert.equal((await call('PATCH', `/api/entities/${crash.id}`, { token: edit.token, body: { Name: 'x' } })).status, 404);
    assert.equal((await call('PATCH', `/api/entities/${sys.id}`, { token: edit.token, body: { Name: 'x' } })).status, 404);
    assert.equal((await call('POST', `/api/tables/${task.id}/entities`, { token: edit.token, body: { Name: 'New' } })).status, 403, 'edit never creates');
    assert.equal((await call('DELETE', `/api/entities/${two.id}`, { token: edit.token })).status, 403, 'edit never deletes');

    const manage = mint({ kind: 'table', id: task.id }, { mode: 'manage' });
    const made = await call('POST', `/api/tables/${task.id}/entities`, { token: manage.token, body: { Name: 'Made by share' } });
    assert.equal(made.status, 201);
    assert.equal((await call('DELETE', `/api/entities/${two.id}`, { token: manage.token })).status, 200);
    assert.ok(w.getEntity(two.id).deletedAt);
    assert.equal((await call('DELETE', `/api/entities/${one.id}?hard=1`, { token: manage.token })).status, 403, 'a share never purges');
    for (const [m, p, body] of [
      ['POST', '/api/tables', { space: 'Dev', name: 'Sneaky' }],
      ['PATCH', `/api/tables/${task.id}`, { name: 'Renamed' }],
      ['POST', `/api/tables/${task.id}/fields`, { name: 'F', type: 'text' }],
      ['POST', '/api/spaces', { name: 'S' }],
      ['POST', `/api/tables/${sys.dbId}/entities`, { Name: 'row' }],
      ['PUT', '/api/schema', {}],
      ['POST', '/api/import', {}],
    ]) {
      const res = await call(m, p, { token: manage.token, body });
      assert.ok([403, 404].includes(res.status), `${m} ${p} answered ${res.status}`);
    }
    assert.equal(w.findTable('Dev/Sneaky'), undefined);
    const editAudit = w.listAudit({ limit: 5 });
    assert.ok(editAudit.every((r) => !r.action.startsWith('table-') && !r.action.startsWith('field-')));
  } finally {
    stop();
  }
});

test('a private link opens only for a signed-in account', async () => {
  const { w, one, call, mint, stop } = await serve();
  try {
    const g = mint({ kind: 'entity', id: one.id }, { visibility: 'private' });
    const anon = await call('GET', `/s/${g.token}/e/${one.id}/entity.html`);
    assert.equal(anon.status, 401);
    assert.equal((await call('GET', '/api/share', { token: g.token })).status, 401);
    const cookie = `wv_session_${w.state.meta.id}=${w.createSession('eye').token}`;
    assert.equal((await call('GET', `/s/${g.token}/e/${one.id}/entity.html`, { cookie })).status, 200);
    assert.equal((await call('GET', '/api/share', { token: g.token, cookie })).status, 200);
  } finally {
    stop();
  }
});

test('REST mint, list and revoke follow the roles: editors mint, architects revoke any, observers neither', async () => {
  const { w, one, call, architect, editor, observer, stop } = await serve();
  try {
    const scope = { kind: 'entity', id: one.id };
    assert.equal((await call('POST', '/api/shares', { token: observer, body: { scope } })).status, 403);
    assert.equal((await call('GET', '/api/shares', { token: observer })).status, 403);
    const made = await call('POST', '/api/shares', { token: editor, body: { scope, mode: 'edit', label: 'bot link' } });
    assert.equal(made.status, 201);
    const g = await made.json();
    assert.match(g.token, /^wvs_/);
    assert.equal(g.url, `/s/${g.token}`);
    assert.equal(g.createdBy, 'bot');
    assert.equal((await call('POST', '/api/shares', { token: editor, body: { scope, mode: 'comment' } })).status, 403);
    const listed = await (await call('GET', `/api/shares?kind=entity&id=${one.id}`, { token: editor })).json();
    assert.deepEqual(listed.map((x) => x.id), [g.id]);
    w.actor = 'kyle';
    const theirs = w.mintShare({ scope });
    assert.equal((await call('DELETE', `/api/shares/${theirs.id}`, { token: editor })).status, 403, 'an editor revokes only its own');
    assert.equal((await call('DELETE', `/api/shares/${g.id}`, { token: editor })).status, 200);
    assert.equal((await call('DELETE', `/api/shares/${theirs.id}`, { token: observer })).status, 403);
    assert.equal((await call('DELETE', `/api/shares/${theirs.id}`, { token: architect })).status, 200);
    assert.equal(w.listShares().length, 0);
    for (const [m, p] of [['GET', '/api/shares'], ['POST', '/api/shares'], ['GET', '/api/share']]) {
      assert.equal((await call(m, p)).status, 401, `${m} ${p} is walled for nobody`);
    }
  } finally {
    stop();
  }
});

test('/view/<token> becomes a redirect to /s/, so a link already handed out keeps working', async () => {
  const { w, call, stop } = await serve();
  try {
    const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task', where: [['Name', '=', 'One']] }] });
    const { token } = w.shareView(v.id);
    const hop = await call('GET', `/view/${token}`);
    assert.equal(hop.status, 302);
    assert.equal(hop.headers.get('location'), `/s/${token}`);
    const land = await call('GET', `/s/${token}`);
    assert.equal(land.headers.get('location'), `/s/${token}/view/${v.id}`);
    const html = await (await call('GET', land.headers.get('location'))).text();
    assert.match(html, /One/);
    assert.equal((await call('GET', '/view/nosuchtoken')).status, 404);
  } finally {
    stop();
  }
});

test('the MCP tool and the CLI verb mint, list and revoke', () => {
  const { w, one } = seed();
  const g = dispatchTool(w, 'weave_shares', { action: 'mint', kind: 'entity', id: one.id, mode: 'edit', label: 'agent' });
  assert.match(g.token, /^wvs_/);
  assert.equal(dispatchTool(w, 'weave_shares', { action: 'list' }).shares.length, 1);
  assert.throws(() => dispatchTool(w, 'weave_shares', { action: 'list' }, { caller: { role: 'observer' } }), /editor or architect/);
  assert.ok(dispatchTool(w, 'weave_shares', { action: 'revoke', share: g.id }).revokedAt);
  assert.throws(() => dispatchTool(w, 'weave_shares', { action: 'nope' }), /list, mint, revoke/);

  const dir = mkdtempSync(join(tmpdir(), 'weave-share-cli-'));
  try {
    const data = join(dir, 'ws.db');
    const cli = (...args) => execFileSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    cli('space', 'create', 'Dev');
    cli('table', 'create', 'Dev', 'Task');
    const minted = JSON.parse(cli('share', 'mint', 'table', 'Dev/Task', '--mode', 'manage', '--label', 'ci'));
    assert.match(minted.token, /^wvs_/);
    assert.equal(minted.mode, 'manage');
    assert.equal(JSON.parse(cli('share', 'list')).length, 1);
    assert.ok(JSON.parse(cli('share', 'revoke', minted.id)).revokedAt);
    assert.equal(JSON.parse(cli('share', 'list')).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
