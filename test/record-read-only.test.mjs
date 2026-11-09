import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { client } = await import('./lib/fixtures.mjs');

function build() {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'Handbook' });
  w.createSpace({ name: 'Ops' });
  const guide = w.createTable({ space: 'Handbook', name: 'Guide' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  const quickstart = w.createEntity(guide.id, { name: 'Quickstart' });
  const chore = w.createEntity(task.id, { name: 'Chore' });
  const t = {
    arc: w.createAccount({ name: 'arc', role: 'architect' }).token,
    ed: w.createAccount({ name: 'ed', role: 'editor' }).token,
    obs: w.createAccount({ name: 'obs', role: 'observer' }).token,
  };
  w.setSpaceMember('Ops', 'obs', { role: 'editor' });
  return { call: client(createWorkspaceHub(w)), quickstart, chore, t };
}

test('a record read by an observer of its space comes back marked read-only (Issue #1537)', async () => {
  const { call, quickstart, t } = build();
  const res = await call('GET', `/api/entities/${quickstart.id}`, { token: t.obs });
  assert.equal(res.status, 200);
  assert.equal(res.json.readOnly, true);
});

test('editors and architects read the same record without the read-only mark', async () => {
  const { call, quickstart, t } = build();
  for (const token of [t.ed, t.arc]) {
    const res = await call('GET', `/api/entities/${quickstart.id}`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.json.readOnly, undefined);
  }
});

test('the mark follows the space role, so an observer made editor of one space edits its records', async () => {
  const { call, chore, t } = build();
  const res = await call('GET', `/api/entities/${chore.id}`, { token: t.obs });
  assert.equal(res.status, 200);
  assert.equal(res.json.readOnly, undefined);
});
