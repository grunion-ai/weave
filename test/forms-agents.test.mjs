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
