import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { unwrapData } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

let rpcId = 0;
function call(w, name, args) {
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  const text = unwrapData(res.result.content[0].text);
  assert.ok(!res.result.isError, `${name}: ${text}`);
  return JSON.parse(text);
}

function deals() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(t, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  w.addField(t, { name: 'Tags', type: 'multiselect', config: { options: ['Hot', 'Cold', 'Warm'] } });
  w.addField(t, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  w.createEntity(t, { Name: 'Acme', Stage: 'Won', Tags: ['Hot', 'Cold'], Status: 'Done' });
  w.createEntity(t, { Name: 'Globex', Stage: 'Won', Tags: ['Hot'] });
  w.createEntity(t, { Name: 'Initech', Stage: 'Lead' });
  return { w, t };
}

test('removing a select option that records hold answers lossy with the orphaned count, compact and verbose (Issue #1561)', () => {
  const { w } = deals();
  const compact = call(w, 'weave_update_field', { db: 'Deal', field: 'Stage', config: { options: ['Lead'] } });
  assert.equal(compact.lossy, true);
  assert.deepEqual(compact.orphaned, { won: 2 });
  assert.ok(compact.activity, 'the compact reply names the entry to roll back');
  const { w: w2 } = deals();
  const verbose = call(w2, 'weave_update_field', { db: 'Deal', field: 'Stage', config: { options: ['Lead'] }, verbose: true });
  assert.equal(verbose.lossy, true);
  assert.deepEqual(verbose.orphaned, { won: 2 });
  assert.equal(w2.readEntity('Deal#1').fields.Stage, 'won', 'the stored id stays, so re-adding the option restores it');
});

test('multiselect values and workflow states outside the new set are counted too', () => {
  const { w } = deals();
  const tags = call(w, 'weave_update_field', { db: 'Deal', field: 'Tags', config: { options: ['Cold', 'Warm'] } });
  assert.equal(tags.lossy, true);
  assert.deepEqual(tags.orphaned, { hot: 2 });
  const states = structuredClone(w.getField('Deal', 'Status').config.states);
  const done = states.find((s) => s.name === 'Done').id;
  const flow = call(w, 'weave_update_field', { db: 'Deal', field: 'Status', config: { states: states.filter((s) => s.name === 'New') } });
  assert.equal(flow.lossy, true);
  assert.deepEqual(flow.orphaned, { [done]: 1 });
});

test('an options change that orphans nothing stays brief and is not lossy', () => {
  const { w } = deals();
  const recolor = call(w, 'weave_update_field', { db: 'Deal', field: 'Stage', config: { options: [{ name: 'Lead', hue: 'blue' }, { name: 'Won', hue: 'green' }] } });
  assert.equal(recolor.lossy, undefined);
  assert.equal(recolor.orphaned, undefined);
  const unused = call(w, 'weave_update_field', { db: 'Deal', field: 'Tags', config: { options: ['Hot', 'Cold'] }, verbose: true });
  assert.equal(unused.lossy, false, 'removing an option no record holds loses nothing');
  assert.equal(unused.orphaned, undefined);
});

test('the orphaning entry still rolls back and brings the option back', () => {
  const { w } = deals();
  const reply = call(w, 'weave_update_field', { db: 'Deal', field: 'Stage', config: { options: ['Lead'] } });
  w.rollbackFieldConfig(reply.activity);
  assert.deepEqual(w.getField('Deal', 'Stage').config.options.map((o) => o.name), ['Lead', 'Won']);
  assert.equal(w.readEntity('Deal#1').fields.Stage, 'Won');
});

test('the HTTP door and the terminal answer the same orphaned count', async () => {
  const { w, t } = deals();
  const admin = w.createAccount({ name: 'admin-bot', role: 'admin' }).token;
  const { server } = await startServer(w, { port: 0 });
  try {
    const f = w.getField(t.id, 'Stage');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/${t.id}/fields/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ config: { options: [{ id: 'lead', name: 'Lead' }] } }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.lossy, true);
    assert.deepEqual(body.orphaned, { won: 2 });
  } finally { server.close(); }

  const dir = tempDir('weave-orphans-cli-');
  const data = join(dir, 'ws.db');
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    cli('space', 'create', 'Sales');
    cli('table', 'create', 'Sales', 'Deal');
    cli('field', 'add', 'Deal', 'Stage', 'select', '--config', '{"options":["Lead","Won"]}');
    cli('create', 'Deal', '--values', '{"Name":"Acme","Stage":"Won"}');
    const out = JSON.parse(cli('field', 'update', 'Deal', 'Stage', '--config', '{"options":["Lead"]}'));
    assert.equal(out.lossy, true);
    assert.deepEqual(out.orphaned, { won: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
