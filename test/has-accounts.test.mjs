import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

const dir = tempDir('weave-has-accounts-');
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { mayAdminister } = await import('../src/mcp.js');
const { startServer } = await import('../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const ROLES = ['architect', 'editor', 'commenter', 'observer', 'viewer', null, undefined];
const before = (w, role) => Weave.roleName(role) === 'architect' || !w.listAccounts().length;

function check(w, label) {
  assert.equal(w.hasAccounts(), w.listAccounts().length > 0, `${label}: hasAccounts answers what listAccounts().length did`);
  for (const role of ROLES) assert.equal(mayAdminister(w, role), before(w, role), `${label}: mayAdminister for ${role}`);
}

test('hasAccounts and every gate built on it answer as listAccounts().length did, through the account lifecycle (Issue #1580)', () => {
  const w = new Weave();
  check(w, 'fresh');
  w.createSpace({ name: 'Ops' });
  w.setRequireAuth(true);
  check(w, 'protected, no account');
  const root = w.createAccount({ name: 'root', role: 'architect' });
  check(w, 'one architect');
  const scoped = w.createAccount({ name: 'scoped', role: 'editor', space: 'Ops' });
  check(w, 'plus a space account');
  w.deleteAccount(scoped.account.id);
  check(w, 'space account removed');
  w.deleteAccount(root.account.id);
  check(w, 'last account removed');
  w.state.meta.accounts = undefined;
  check(w, 'no accounts map at all');
});

test('an authenticated request on a workspace with accounts never builds the account list just to learn that one exists (Issue #1580)', async () => {
  const w = new Weave();
  for (let i = 0; i < 30; i++) w.createSpace({ name: `S${i}` });
  w.createTable({ space: 'S0', name: 'Item' });
  const token = w.createAccount({ name: 'root', role: 'architect' }).token;
  const eye = w.createAccount({ name: 'eye', role: 'observer' }).token;
  w.setRequireAuth(true);
  let lists = 0;
  const listAccounts = w.listAccounts.bind(w);
  w.listAccounts = () => { lists += 1; return listAccounts(); };
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, t) => fetch(`${base}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  try {
    const ok = await get('/api/tables', token);
    assert.equal(ok.status, 200);
    await ok.arrayBuffer();
    const observed = await get('/api/tables', eye);
    assert.equal(observed.status, 200);
    await observed.arrayBuffer();
    const refused = await get('/api/tables');
    assert.equal(refused.status, 401, 'no token is still refused');
    await refused.arrayBuffer();
    const bad = await get('/api/tables', 'not-a-token');
    assert.equal(bad.status, 401, 'a wrong token is still refused');
    await bad.arrayBuffer();
  } finally { server.close(); }
  assert.equal(lists, 0, `listAccounts ran ${lists} times for four requests`);
});
