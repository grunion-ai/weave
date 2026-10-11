import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { dispatchTool } = await import('../../src/mcp.js');
const { SHARE_TTL_MS } = await import('../../src/shares.js');
const { client } = await import('../lib/fixtures.mjs');

const DAY = 24 * 60 * 60 * 1000;

function build({ wall = true, path = null } = {}) {
  const w = new Weave(path ? { path } : {});
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const row = w.createEntity('Dev/Task', { name: 'one' });
  const architect = w.createAccount({ name: 'ar', role: 'architect' }).token;
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  const observer = w.createAccount({ name: 'ob', role: 'observer' }).token;
  if (wall) w.setRequireAuth(true);
  return { w, row, architect, editor, observer, call: client(createWorkspaceHub(w)) };
}

const within = (iso, expectedMs, slackMs = 60_000) => Math.abs(Date.parse(iso) - expectedMs) <= slackMs;

test('an editor creates a saved view but cannot share or unshare it, mint, list or revoke any link', async () => {
  const { w, row, call, editor, observer } = build();
  const view = await call('POST', '/api/views', { token: editor, body: { name: 'Mine', blocks: [{ table: 'Task' }] } });
  assert.equal(view.status, 201);
  for (const token of [editor, observer]) {
    assert.equal((await call('POST', `/api/views/${view.json.id}/share`, { token })).status, 403);
    assert.equal((await call('DELETE', `/api/views/${view.json.id}/share`, { token })).status, 403);
    assert.equal((await call('POST', '/api/shares', { token, body: { scope: { kind: 'entity', id: row.id } } })).status, 403);
    assert.equal((await call('GET', '/api/shares', { token })).status, 403);
  }
  assert.equal(w.listShares().length, 0, 'no grant was minted');
});

test('an editor cannot read back the token of a link an architect minted, nor revoke it', async () => {
  const { w, row, call, editor, architect } = build();
  const made = await call('POST', '/api/shares', { token: architect, body: { scope: { kind: 'entity', id: row.id }, label: 'vendor' } });
  assert.equal(made.status, 201);
  assert.match(made.json.token, /^wvs_/);
  const view = w.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  const shared = await call('POST', `/api/views/${view.id}/share`, { token: architect });
  assert.equal(shared.status, 201);
  const again = await call('POST', `/api/views/${view.id}/share`, { token: editor });
  assert.equal(again.status, 403);
  assert.ok(!JSON.stringify(again.json).includes(shared.json.token));
  assert.equal((await call('GET', `/api/shares?kind=view&id=${view.id}`, { token: editor })).status, 403);
  assert.equal((await call('DELETE', `/api/shares/${made.json.id}`, { token: editor })).status, 403);
  assert.ok(w.shareByToken(made.json.token), 'the link is still live');
  assert.equal((await call('DELETE', `/api/shares/${made.json.id}`, { token: architect })).status, 200);
  assert.equal(w.shareByToken(made.json.token), null);
});

test('with no credentials on a walled workspace every share route answers 401', async () => {
  const { row, call } = build();
  assert.equal((await call('POST', '/api/shares', { body: { scope: { kind: 'entity', id: row.id } } })).status, 401);
  assert.equal((await call('GET', '/api/shares')).status, 401);
});

test('a new link expires thirty days out, and /view/<token> stops answering once it has', async () => {
  const { w, call, architect } = build();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  const shared = await call('POST', `/api/views/${v.id}/share`, { token: architect });
  assert.equal(shared.status, 201);
  const [grant] = w.listShares({ kind: 'view', id: v.id });
  assert.equal(SHARE_TTL_MS, 30 * DAY);
  assert.ok(within(grant.expiresAt, Date.now() + SHARE_TTL_MS), `expires ${grant.expiresAt}`);
  const hop = await call('GET', `/view/${shared.json.token}`);
  assert.equal(hop.status, 302);
  w.now = () => new Date(Date.now() + 31 * DAY);
  assert.equal((await call('GET', `/view/${shared.json.token}`)).status, 404);
  assert.equal(w.listShares({ kind: 'view', id: v.id }).length, 0, 'an expired link is gone from the list');
  assert.equal(w.shareByToken(shared.json.token), null);
});

test('an explicit expiry still wins, and an architect renews a link for another thirty days', async () => {
  const { w, row, call, architect, editor } = build();
  const soon = new Date(Date.now() + 2 * DAY).toISOString();
  const made = await call('POST', '/api/shares', { token: architect, body: { scope: { kind: 'entity', id: row.id }, expiresAt: soon } });
  assert.equal(made.status, 201);
  assert.equal(made.json.expiresAt, soon);
  assert.equal((await call('POST', `/api/shares/${made.json.id}/renew`, { token: editor })).status, 403);
  const renewed = await call('POST', `/api/shares/${made.json.id}/renew`, { token: architect });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.json.token, made.json.token, 'the same link, handed out already, keeps working');
  assert.ok(within(renewed.json.expiresAt, Date.now() + SHARE_TTL_MS), `renewed to ${renewed.json.expiresAt}`);
  assert.equal(w.listAudit({ limit: 5 })[0].action, 'share-renewed');
  assert.equal((await call('DELETE', `/api/shares/${made.json.id}`, { token: architect })).status, 200);
  assert.equal((await call('POST', `/api/shares/${made.json.id}/renew`, { token: architect })).status, 404, 'a revoked link is not renewed');
});

test('a link minted before expiry existed is given thirty days from the upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-share-legacy-'));
  const path = join(dir, 'ws.db');
  const { w, row } = build({ path });
  w.actor = 'ar';
  const g = w.mintShare({ scope: { kind: 'entity', id: row.id } });
  w.state.meta.shares[g.id].expiresAt = null;
  w.save();
  w.store.close?.();
  const reopened = new Weave({ path });
  const kept = reopened.state.meta.shares[g.id];
  assert.ok(within(kept.expiresAt, Date.now() + SHARE_TTL_MS), `legacy link now expires ${kept.expiresAt}`);
  assert.ok(reopened.shareByToken(g.token), 'and still opens until then');
});

test('over MCP the share tools need an architect; a local stdio caller is unchanged', () => {
  const { w, row } = build({ wall: false });
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  for (const role of ['editor', 'observer']) {
    assert.throws(() => dispatchTool(w, 'weave_shares', { action: 'mint', kind: 'entity', id: row.id }, { caller: { role } }), /architect/);
    assert.throws(() => dispatchTool(w, 'weave_shares', { action: 'list' }, { caller: { role } }), /architect/);
    assert.throws(() => dispatchTool(w, 'weave_views', { action: 'share', view: v.id }, { caller: { role } }), /architect/);
    assert.throws(() => dispatchTool(w, 'weave_views', { action: 'unshare', view: v.id }, { caller: { role } }), /architect/);
  }
  assert.equal(w.listShares().length, 0);
  assert.match(dispatchTool(w, 'weave_views', { action: 'share', view: v.id }, { caller: { role: 'architect' } }).token, /^wvs_/);
  const g = dispatchTool(w, 'weave_shares', { action: 'mint', kind: 'entity', id: row.id });
  assert.ok(within(g.expiresAt, Date.now() + SHARE_TTL_MS));
  assert.ok(within(dispatchTool(w, 'weave_shares', { action: 'renew', share: g.id }).expiresAt, Date.now() + SHARE_TTL_MS));
});
