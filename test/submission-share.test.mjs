import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { Weave, WeaveError } from '../src/engine.js';
import { createForm, getForm, formAdmits, submitForm, renderFormPage } from '../src/forms.js';
import { startServer } from '../src/server.js';

function fixture(path) {
  const w = new Weave({ path });
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Reporter', type: 'text' });
  w.addField(table.id, { name: 'Count', type: 'number' });
  const form = createForm(w, { name: 'New request', table: table.id, fields: [{ field: 'Name', required: true }, 'Count'], hidden: { Reporter: '$actor' }, shareOnly: true });
  return { w, table, form };
}

test('submission-only forms are never public by stable ID, including auth-off workspaces', async t => {
  const { w, form } = fixture();
  assert.equal(getForm(w, form.id).shareOnly, true);
  for (const context of [{}, { anonymous: true }, { role: 'architect', anonymous: true }]) assert.equal(formAdmits(form, context), false);
  assert.throws(() => submitForm(w, form.id, { values: { Name: 'Bypass' } }), /live submission link/);
  const { server } = await startServer(w, { port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of [`/f/${form.id}`, `/api/forms/${form.id}`]) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.notEqual(response.status, 200, path);
  }
  const response = await fetch(`${base}/api/forms/${form.id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: { Name: 'Bypass' } }) });
  assert.equal(response.status, 401);
  assert.equal(w.listEntities(w.getTable('Intake/Request').id).length, 0);
});

test('submission authorization runs before replay and rejects revoked stale-page requests atomically', () => {
  const { w, form, table } = fixture();
  let live = true;
  let calls = 0;
  const options = { actor: 'anonymous', scope: 'token-one', idempotencyKey: 'retry', authorize: current => {
    calls++;
    assert.equal(current.id, form.id);
    if (!live) throw new WeaveError('Link expired', 'forbidden');
  } };
  const input = { values: { Name: 'Created' } };
  const first = submitForm(w, form.id, input, options);
  assert.equal(submitForm(w, form.id, input, options).id, first.id);
  live = false;
  assert.throws(() => submitForm(w, form.id, input, options), /Link expired/);
  assert.throws(() => submitForm(w, form.id, { values: { Name: 'New' } }, { ...options, idempotencyKey: 'another' }), /Link expired/);
  assert.equal(calls, 4);
  assert.equal(w.listEntities(table.id).length, 1);
});

test('submission capabilities enforce field allowlists, required fields, hidden values and typed inputs', () => {
  const { w, form, table } = fixture();
  const options = { actor: 'anonymous', authorize: () => {} };
  for (const values of [{}, { Name: 'x', Reporter: 'forged' }, { Name: 'x', Count: 'bad' }, { Name: 'x', Surprise: 'injected' }]) assert.throws(() => submitForm(w, form.id, { values }, options));
  assert.equal(w.listEntities(table.id).length, 0);
  const receipt = submitForm(w, form.id, { values: { Name: 'Allowed', Count: '1.5' } }, options);
  assert.equal(w.readEntity(receipt.id).fields.Count, 1.5);
  assert.equal(w.readEntity(receipt.id).fields.Reporter, 'anonymous');
});

test('submission form rendering uses the capability endpoint and suppresses referrers', () => {
  const { form } = fixture();
  const endpoint = `/s/wvs_capability/api/forms/${form.id}/submit`;
  const html = renderFormPage(form, { submitUrl: endpoint });
  assert.ok(html.includes(`data-submit="${endpoint}"`));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(!html.includes(`data-submit="/api/forms/${form.id}`));
});

test('submission-only protection and retry receipts survive storage reload', () => {
  const dir = tempDir('weave-submission-share-');
  let w;
  let reopened;
  try {
    const path = join(dir, 'workspace.db');
    const seed = fixture(path);
    w = seed.w;
    const grant = w.mintShare({ scope: { kind: 'table', id: seed.table.id }, mode: 'submit', formId: seed.form.id, expiry: 'never' });
    const input = { values: { Name: 'Durable response' } };
    const options = engine => ({ actor: 'anonymous', scope: grant.token, idempotencyKey: 'retry', authorize: () => {
      if (!engine.shareByToken(grant.token)) throw new WeaveError('Expired link', 'forbidden');
    } });
    const first = submitForm(w, seed.form.id, input, options(w));
    reopened = new Weave({ path });
    assert.equal(getForm(reopened, seed.form.id).shareOnly, true);
    assert.equal(submitForm(reopened, seed.form.id, input, options(reopened)).id, first.id);
    assert.throws(() => submitForm(reopened, seed.form.id, input), /live submission link/);
    reopened.regenerateShare(grant.id);
    assert.throws(() => submitForm(w, seed.form.id, input, options(w)), /Expired link/);
    assert.equal(reopened.listEntities(seed.table.id).length, 1);
  } finally {
    w?.store.close();
    reopened?.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
