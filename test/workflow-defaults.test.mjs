/* A new state field arrives with states already in it (Issue #251).

   A workflow field with no `states` used to be a refusal — "Workflow field
   needs at least one state" — so every new state column made you invent and
   type a status vocabulary before the column could exist at all, in the tray
   and on the CLI alike. The engine already knows four state categories, and
   those four ARE the sensible starting lifecycle: Not started · In progress ·
   Done · Canceled, the first one the default.

   The seed sits at the point of blankness, not in a weakened validation: a
   config that OMITS states gets the four, a config that carries an empty
   array is still invalid — a list someone deliberately emptied is not a
   lifecycle. The browser half is workflow-defaults-browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

await import('../public/field-dialog-core.js');
const FDC = globalThis.weaveFieldDialogCore ?? globalThis.fieldDialogCore;
const ENGINE = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
const HB = readFileSync(new URL('../src/handbook.js', import.meta.url), 'utf8');

const NAMES = ['Not started', 'In progress', 'Done', 'Canceled'];
const CATS = ['not-started', 'in-progress', 'done', 'canceled'];

function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  return { w, t: w.createTable({ space: 'Ops', name: 'Task' }) };
}

test('a workflow field with no config is created with the four default states', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', type: 'workflow' });
  assert.deepEqual(f.config.states.map((s) => s.name), NAMES);
  assert.deepEqual(f.config.states.map((s) => s.category), CATS);
  assert.deepEqual(f.config.states.map((s) => s.default), [true, false, false, false],
    'Not started leads, and it is the default');
  // A row lands on the default state like any other workflow field.
  const e = w.createEntity(t, { name: 'Ship it' });
  assert.equal(w.readEntity(e.id).fields.Status, 'Not started');
});

test('an explicitly empty states array is still refused', () => {
  const { w, t } = ws();
  assert.throws(() => w.addField(t, { name: 'Status', type: 'workflow', config: { states: [] } }),
    /at least one state/i, 'a list emptied on purpose is not a lifecycle');
  // And an edit cannot empty one either.
  const f = w.addField(t, { name: 'Stage', type: 'workflow' });
  assert.throws(() => w.updateField(t, f.id, { config: { states: [] } }), /at least one state/i);
  assert.equal(w.getField(t, f.id).config.states.length, 4, 'the refusal left the field intact');
});

test('states given by hand are still exactly what is stored', () => {
  const { w, t } = ws();
  const f = w.addField(t, {
    name: 'Status',
    type: 'workflow',
    config: { states: [{ name: 'Pending', category: 'not-started' }, { name: 'Approved', category: 'done' }] },
  });
  assert.deepEqual(f.config.states.map((s) => s.name), ['Pending', 'Approved'],
    'the seed never joins a vocabulary someone wrote');
});

test('a select with nothing in it can still become a workflow — it gets the defaults', () => {
  const { w, t } = ws();
  const sel = w.addField(t, { name: 'Stage', type: 'select' });
  w.updateField(t, sel.id, { type: 'workflow' });
  assert.deepEqual(w.getField(t, sel.id).config.states.map((s) => s.name), NAMES);
});

test('the CLI adds a state column with no --config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-wf-'));
  try {
    const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', join(dir, 'ws.json')], { encoding: 'utf8' });
    cli('space', 'create', 'Work');
    cli('db', 'create', 'Work', 'Task');
    const f = JSON.parse(cli('field', 'add', 'Task', 'Status', 'workflow'));
    assert.deepEqual(f.config.states.map((s) => s.name), NAMES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the REST route and the MCP tool seed the same four', async () => {
  const { w, t } = ws();
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/${t.id}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Status', type: 'workflow' }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual((await res.json()).config.states.map((s) => s.name), NAMES);
  } finally {
    server.close();
  }
  const viaMcp = dispatchTool(w, 'weave_add_field', { db: t.id, name: 'Stage', type: 'workflow' });
  assert.deepEqual(viaMcp.config.states.map((s) => s.name), NAMES);
});

test('the tray hands back the same four states the engine seeds', () => {
  const blank = FDC.blankState('workflow');
  assert.deepEqual(blank.states.map((s) => s.name), NAMES, 'a fresh workflow tray is not an empty list');
  assert.deepEqual(blank.states.map((s) => s.category), CATS);
  // Saving the tray untouched is a valid definition, and it round-trips.
  const def = FDC.definitionFromState(blank);
  assert.equal(FDC.parseDefinition(JSON.stringify(def)).error, undefined);
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', ...def });
  assert.deepEqual(f.config.states.map((s) => s.name), NAMES);
  // A definition pasted with no states reads back as the defaults too.
  assert.deepEqual(FDC.stateFromDefinition({ type: 'workflow', config: {} }).states.map((s) => s.name), NAMES);
  assert.deepEqual(FDC.stateFromDefinition({ type: 'workflow', config: { states: [] } }).states, [],
    'an emptied list stays empty, and the validator refuses it');
  assert.match(FDC.parseDefinition('{ "type": "workflow", "config": { "states": [] } }').error, /at least one state/);
  assert.equal(FDC.parseDefinition('{ "type": "workflow", "config": {} }').error, undefined,
    'omitting states is not an error any more — it is the default lifecycle');
});

test('the dialog and the engine name the same default states, and the Handbook prints them', () => {
  const literal = ENGINE.match(/const DEFAULT_WORKFLOW_STATES = \[([\s\S]*?)\];/)[1];
  const names = [...literal.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names, NAMES, 'the engine literal is the source of the four');
  assert.deepEqual(FDC.DEFAULT_WORKFLOW_STATES.map((s) => s.name), names, 'the dialog copy has not drifted');
  assert.deepEqual(FDC.DEFAULT_WORKFLOW_STATES.map((s) => s.category), CATS);
  const page = HB.match(/\{ name: 'workflow', kind: '[^']*', doc: `([\s\S]*?)` \},/)[1];
  for (const n of NAMES) assert.ok(page.includes(n), `the workflow page names ${n}`);
  assert.match(page, /default/i);
});
