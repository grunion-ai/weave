import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withinScope, sharePage, expireLegacy, shareGate, scopedMention } from '../src/shares.js';

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const table = w.createTable({ space: 'Dev', name: 'Task' });
  const a = w.createEntity(table.id, { name: 'A' });
  const b = w.createEntity(table.id, { name: 'B' });
  return { w, table, a, b };
}

test('beta rotation retains grant identity and invalidates previous credential', () => {
  const { w, table } = seed();
  const first = w.mintShare({ scope: { kind: 'table', id: table.id }, expiry: 'never' });
  assert.equal(first.expiresAt, null);
  expireLegacy(w.state, Date.now());
  assert.equal(w.shareByToken(first.token).expiresAt, null);
  const next = w.regenerateShare(first.id, { expiry: '1h' });
  assert.equal(next.id, first.id);
  assert.notEqual(next.token, first.token);
  assert.equal(w.shareByToken(first.token), null);
  assert.equal(w.shareByToken(next.token).id, first.id);
  assert.ok(Math.abs(Date.parse(next.expiresAt) - Date.now() - 3600000) < 5000);
  w.revokeShare(next.id);
  assert.equal(w.listShares().length, 0);
  assert.equal(w.listShares({ includeInactive: true })[0].status, 'revoked');
});

test('beta edit validates before mutation and selected scope cannot widen', () => {
  const { w, table, a, b } = seed();
  const g = w.mintShare({ scope: { kind: 'entities', ids: [a.id] }, expiry: '7d' });
  assert.equal(withinScope(w, g, { entityId: a.id }), true);
  assert.equal(withinScope(w, g, { entityId: b.id }), false);
  assert.equal(withinScope(w, g, { tableId: table.id }), false);
  assert.throws(() => w.updateShare(g.id, { label: 'bad', expiresAt: 'yesterday' }), { code: 'invalid' });
  assert.equal(w.shareByToken(g.token).label, '');
  assert.throws(() => w.updateShare(g.id, { scope: { kind: 'workspace' } }), { code: 'invalid' });
  assert.throws(() => w.mintShare({ scope: { kind: 'table', id: table.id }, audience: { kind: 'email' } }), { code: 'invalid' });
});

test('beta public HTTP URLs use workspace UUID, support edits, and scope pages remain bounded', async () => {
  const { startServer } = await import('../src/server.js');
  const { w, table, a, b } = seed();
  const root = w.createAccount({ name: 'root', role: 'architect' }).token;
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = (path, method = 'GET', body) => fetch(base + path, { method, headers: { Authorization: `Bearer ${root}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    const created = await api('/api/shares', 'POST', { scope: { kind: 'entities', ids: [a.id] }, expiry: 'never' });
    assert.equal(created.status, 201);
    const link = await created.json();
    assert.equal(link.url, `/w/${w.state.meta.id}/s/${link.token}`);
    const page = await fetch(base + link.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(a.id));
    assert.ok(!html.includes(b.id));
    const read = path => fetch(base + path, { headers: { Authorization: `Bearer ${link.token}` } });
    const rows = await (await read(`/api/tables/${table.id}/entities?offset=1`)).json();
    assert.equal(rows.total, 1);
    assert.equal(rows.items.length, 0);
    assert.equal((await api(`/api/shares/${link.id}`, 'PATCH', { expiry: '1d' })).status, 200);
    const rotated = await (await api(`/api/shares/${link.id}/regenerate`, 'POST', {})).json();
    assert.notEqual(rotated.token, link.token);
    assert.equal((await fetch(base + link.url)).status, 404);
    assert.equal((await fetch(base + rotated.url)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('recipient saved view, search and sorting never mutate saved views or expand scope', () => {
  const { w, table, a, b } = seed();
  const grant = w.mintShare({ scope: { kind: 'table', id: table.id } });
  const before = JSON.stringify(w.getTable(table.id).tableViews);
  const shown = sharePage(w, grant, `/table/${table.id}`, { method: 'GET', searchParams: new URLSearchParams({ search: 'A', sort: 'desc' }) });
  assert.ok(shown.html.includes(a.id));
  assert.ok(!shown.html.includes(b.id));
  assert.match(shown.html, /Changes are never saved/);
  assert.equal(JSON.stringify(w.getTable(table.id).tableViews), before);
  const selected = w.mintShare({ scope: { kind: 'entities', ids: [a.id] } });
  assert.equal(sharePage(w, selected, `/table/${table.id}`, { method: 'GET', searchParams: new URLSearchParams({ search: '', sort: 'asc' }) }).status, 404);
});


test('selected-entry query omits unscoped aggregate and chip metadata', () => {
  const { w, table, a } = seed();
  const grant = w.mintShare({ scope: { kind: 'entities', ids: [a.id] } });
  const response = shareGate(w, grant, { method: 'POST', path: `/api/tables/${table.id}/query`, body: { relations: 'chip', countAll: true, trashCount: true } });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.data).sort(), ['items', 'total']);
  assert.deepEqual(response.data.items.map(row => row.id), [a.id]);
  assert.equal(response.data.total, 1);
  assert.equal(shareGate(w, grant, { method: 'POST', path: `/api/tables/${table.id}/query`, body: { groupBy: 'Standard' } }).status, 403);
  assert.equal(shareGate(w, grant, { method: 'POST', path: `/api/tables/${table.id}/query`, body: { select: ['Name'] } }).status, 403);
});

test('selected-entry shares omit related records and computed fields from API and every export', async () => {
  const { startServer } = await import('../src/server.js');
  const { w, table, a } = seed();
  const privateTable = w.createTable({ space: 'Dev', name: 'Private' });
  const secret = w.createEntity(privateTable.id, { name: 'UNSHARED-SECRET-NAME' });
  w.addRelation(table.id, { name: 'Private link', targetDb: privateTable.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.updateEntity(a.id, { 'Private link': secret.id });
  w.addField(table.id, { name: 'Private name', type: 'lookup', config: { relationField: 'Private link', targetField: 'Name' } });
  w.addField(table.id, { name: 'Computed', type: 'formula', config: { expression: '42' } });
  const link = w.mintShare({ scope: { kind: 'entities', ids: [a.id] } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of [`/s/${link.token}`, `/s/${link.token}/api/entities/${a.id}`, ...['md', 'mmd', 'html', 'pdf'].map(ext => `/s/${link.token}/e/${a.id}/entity.${ext}`)]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const body = await response.text();
      assert.ok(!body.includes('UNSHARED-SECRET-NAME'), path);
      assert.ok(!body.includes(secret.id), path);
      assert.ok(!body.includes('Private name'), path);
      assert.ok(!body.includes('Computed'), path);
    }
    const row = shareGate(w, link, { method: 'GET', path: `/api/entities/${a.id}` }).data;
    assert.equal(row.fields['Private link'], undefined);
    assert.equal(row.raw['Private name'], undefined);
    assert.equal(row.activity, undefined);
    for (const body of [{ where: [['Private link.Name', '=', 'UNSHARED-SECRET-NAME']] }, { sort: [{ field: 'Private link.Name', dir: 'asc' }] }, { search: 'UNSHARED-SECRET-NAME' }, { fields: ['Private name'] }, { view: 'Standard' }]) {
      assert.equal(shareGate(w, link, { method: 'POST', path: `/api/tables/${table.id}/query`, body }).status, 403);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('selected-entry mentions never carry rich chip fields or derived views', () => {
  const { w, a } = seed();
  const grant = w.mintShare({ scope: { kind: 'entities', ids: [a.id] } });
  const resolve = scopedMention(w, grant, () => ({ label: 'unsafe', name: 'unsafe', fields: { Related: 'PRIVATE' }, view: 'PRIVATE', home: 'PRIVATE' }), `/s/${grant.token}`);
  assert.deepEqual(resolve('entity', a.id), { label: 'A', name: 'A', href: `/s/${grant.token}/e/${a.id}/doc.html` });
});

test('share rotation while a query body is pending invalidates that request', async () => {
  const { request } = await import('node:http');
  const { startServer } = await import('../src/server.js');
  const { w, table } = seed();
  const link = w.mintShare({ scope: { kind: 'table', id: table.id } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const status = await new Promise((resolve, reject) => {
      const client = request({ host: '127.0.0.1', port: server.address().port, path: `/s/${link.token}/api/tables/${table.id}/query`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      client.on('error', reject);
      server.once('request', () => {
        w.regenerateShare(link.id);
        client.end('{}');
      });
      client.flushHeaders();
    });
    assert.equal(status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
