import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { createForm } from '../src/forms.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

function seed(w) {
  w.createSpace({ name: 'Capture' });
  w.createTable({ space: 'Capture', name: 'Request' });
  return createForm(w, { name: 'Send request', table: 'Capture/Request', fields: ['Name'] });
}

test('MCP advertises a retry key and repeated requests return one receipt', () => {
  assert.equal(TOOLS.find((t) => t.name === 'weave_form_submit').inputSchema.properties.idempotencyKey?.type, 'string');
  const w = new Weave();
  const form = seed(w);
  const args = { form: form.id, values: { Name: 'Saved by agent' }, idempotencyKey: 'mcp-attempt-1' };
  const a = dispatchTool(w, 'weave_form_submit', args);
  const b = dispatchTool(w, 'weave_form_submit', args);
  assert.equal(a.id, b.id);
  assert.equal(b.replayed, true);
  assert.throws(() => dispatchTool(w, 'weave_form_submit', { ...args, values: { Name: 'Different' } }), (err) => err.code === 'conflict');
});

test('CLI retries persist across processes and reject changed content with the same key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-forms-agent-'));
  const path = join(dir, 'capture.db');
  const w = new Weave({ path });
  const form = seed(w);
  w.store.close();
  const cli = (name) => execFileSync(process.execPath, [fileURLToPath(new URL('../bin/weave.js', import.meta.url)), '--data', path, 'form', 'submit', form.id, '--values', JSON.stringify({ Name: name }), '--idempotency-key', 'cli-attempt-1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const a = JSON.parse(cli('Saved from shortcut'));
    const b = JSON.parse(cli('Saved from shortcut'));
    assert.equal(a.id, b.id);
    assert.equal(b.replayed, true);
    assert.throws(() => cli('Changed payload'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MCP form management creates and edits one native registry form with architect authorization', () => {
  const w = new Weave();
  seed(w);
  w.createAccount({ name: 'owner', role: 'architect' });
  const admin = { role: 'architect' };
  const args = { action: 'create', definition: { name: 'Native intake', table: 'Capture/Request', fields: [{ field: 'Name', key: 'title', required: true }] } };
  assert.throws(() => dispatchTool(w, 'weave_forms', args, { caller: { role: 'editor' } }), /architect/);
  const form = dispatchTool(w, 'weave_forms', args, { caller: admin });
  assert.equal(form.name, 'Native intake');
  const edited = dispatchTool(w, 'weave_forms', { action: 'update', form: form.id, definition: { name: 'Renamed intake', enabled: false } }, { caller: admin });
  assert.equal(edited.id, form.id);
  assert.equal(edited.enabled, false);
  assert.equal(dispatchTool(w, 'weave_forms', { action: 'get', form: form.id }, { caller: admin }).fields[0].key, 'title');
  assert.throws(() => dispatchTool(w, 'weave_forms', { action: 'get', form: form.id }, { caller: { role: 'observer' } }), /architect/);
  assert.ok(dispatchTool(w, 'weave_forms', { action: 'list' }, { caller: admin }).some(f => f.id === form.id));
});

test('CLI form configuration creates and updates the same saved form', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-native-form-cli-'));
  const path = join(dir, 'capture.db');
  const w = new Weave({ path });
  seed(w);
  w.store.close();
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../bin/weave.js', import.meta.url)), '--data', path, 'form', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    const form = cli('create', '--definition', JSON.stringify({ name: 'CLI intake', table: 'Capture/Request', fields: ['Name'] }));
    const edited = cli('update', form.id, '--definition', JSON.stringify({ name: 'New label', enabled: false }));
    assert.equal(edited.id, form.id);
    assert.equal(edited.enabled, false);
    assert.equal(cli('config', form.id).name, 'New label');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MCP management honors an accountless sign-in wall on the workspace and registry', () => {
  const w = new Weave();
  const form = seed(w);
  w.setRequireAuth(true);
  assert.throws(() => dispatchTool(w, 'weave_forms', { action: 'get', form: form.id }, { caller: { role: null } }), /architect/);
  const member = new Weave();
  member.registryHost = w;
  assert.throws(() => dispatchTool(member, 'weave_forms', { action: 'list' }, { caller: { role: 'architect', rootRole: null } }), /architect/);
});
