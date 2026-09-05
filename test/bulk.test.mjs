/* Bulk verbs (Feature #132, slice 3): one call for a whole selection.
   The puck's Set a field…, Link to…, Move to table… and Roll up… each want
   ONE write at the engine layer rather than a per-row loop from the browser
   (the slice 2 record). `bulk(ids, op, params)` is that verb, and it reports
   per row: `done` names what landed, `failed` names what did not and why —
   a bulk command that half works and reports success is how a row goes
   missing quietly.

   The same verb is reachable from HTTP, MCP and the CLI (the agent-surface
   gate), each row's change is undoable, and each row carries its own
   activity entry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  const bugs = w.createTable({ space: 'Product', name: 'Bug' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, { name: 'Kind', type: 'select', config: { options: ['Chore', 'Feature'] } });
  w.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(tasks, { name: 'Double', type: 'formula', config: { expression: 'Estimate * 2' } });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  // Bug shares Estimate and Kind (same type) with Task; Status is a text
  // field there, so it must NOT carry over — same name, different type.
  w.addField(bugs, { name: 'Estimate', type: 'number' });
  w.addField(bugs, { name: 'Kind', type: 'select', config: { options: ['Chore', 'Feature'] } });
  w.addField(bugs, { name: 'Status', type: 'text' });
  const ids = ['A', 'B', 'C'].map((n) => w.createEntity(tasks, { name: n, values: { Estimate: 1, Kind: 'Chore' } }).id);
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  return { w, projects, tasks, bugs, ids, apollo };
}

test('bulk set writes one value across the selection, undoably, with activity per row', () => {
  const { w, ids } = build();
  const r = w.bulk(ids, 'set', { values: { Estimate: 5, Status: 'Done' } });
  assert.deepEqual(r.done, ids);
  assert.deepEqual(r.failed, []);
  for (const id of ids) {
    const e = w.readEntity(id);
    assert.equal(e.fields.Estimate, 5);
    assert.equal(e.fields.Status, 'Done');
    assert.ok(e.activity.some((a) => a.kind === 'field-updated' && a.detail.field === 'Estimate'), 'each row logs its own change');
  }
  // Each row is its own undo step, so the stack walks back row by row.
  w.undo({ steps: ids.length });
  for (const id of ids) assert.equal(w.readEntity(id).fields.Estimate, 1);
});

test('bulk names what did NOT land, per row, and still lands the rest', () => {
  const { w, ids, apollo } = build();
  // Apollo is a Project: Estimate is not a field there.
  const r = w.bulk([...ids, apollo.id, 'nope'], 'set', { values: { Estimate: 9 } });
  assert.deepEqual(r.done, ids);
  assert.equal(r.failed.length, 2);
  assert.equal(r.failed[0].id, apollo.id);
  assert.match(r.failed[0].error, /Estimate/);
  assert.equal(r.failed[1].id, 'nope');
  assert.equal(w.readEntity(ids[0]).fields.Estimate, 9);
});

test('bulk link connects every selected row to the same target', () => {
  const { w, ids, apollo } = build();
  const r = w.bulk(ids, 'link', { field: 'Project', targets: [apollo.id] });
  assert.deepEqual(r.done, ids);
  assert.equal(w.readEntity(apollo.id).fields.Tasks.length, 3);
  w.undo({ steps: 3 });
  assert.equal(w.readEntity(apollo.id).fields.Tasks.length, 0);
});

test('bulk rollup creates one parent and links the selection to it', () => {
  const { w, ids, projects } = build();
  const r = w.bulk(ids, 'rollup', { field: 'Project', name: 'Sprint 1' });
  assert.deepEqual(r.done, ids);
  assert.equal(r.parent.name, 'Sprint 1');
  assert.equal(r.parent.dbId, projects.id);
  assert.equal(w.readEntity(r.parent.id).fields.Tasks.length, 3);
  for (const id of ids) assert.equal(w.readEntity(id).fields.Project.id, r.parent.id);
});

test('bulk move re-creates each row in the target table by field name and trashes the original', () => {
  const { w, ids, bugs, tasks, apollo } = build();
  w.link(ids[0], 'Project', [apollo.id]);
  const r = w.bulk([ids[0]], 'move', { table: 'Bug' });
  assert.equal(r.done.length, 1);
  const [m] = r.moved;
  assert.equal(m.from, ids[0]);
  const bug = w.readEntity(m.to);
  assert.equal(bug.dbId, bugs.id);
  assert.equal(bug.name, 'A');
  assert.equal(bug.fields.Estimate, 1, 'same name, same type: carried');
  assert.equal(bug.fields.Kind, 'Chore', 'options carry by NAME, not by option id');
  assert.equal(bug.fields.Status ?? null, null, 'same name, different type: not carried');
  // What did not fit is named, so the toast can say it. Double is computed
  // and recomputes on its own — it is not "left behind".
  assert.deepEqual(m.skipped.sort(), ['Project', 'Status']);
  assert.ok(bug.activity.some((a) => a.kind === 'moved' && a.detail.from === 'Product/Task' && a.detail.publicId === 1));
  assert.ok(w.readEntity(ids[0]).deletedAt, 'the original is in the trash, not gone');
  assert.equal(w.listTrash(tasks.id).length, 1);
  // Undo walks back both halves: the trash, then the copy.
  w.undo({ steps: 2 });
  assert.equal(w.readEntity(ids[0]).deletedAt ?? null, null);
  assert.ok(w.readEntity(m.to).deletedAt);
});

test('bulk refuses an unknown op, an empty selection, and moving to a system table', () => {
  const { w, ids } = build();
  assert.throws(() => w.bulk(ids, 'explode', {}), /Unknown bulk op/);
  assert.throws(() => w.bulk([], 'set', { values: {} }), /ids is required/);
  const r = w.bulk(ids, 'move', { table: 'Workspace/Tables' });
  assert.equal(r.done.length, 0);
  assert.match(r.failed[0].error, /system table/);
});

/* ── the three doors ─────────────────────────────────────────────────── */
test('POST /api/bulk is the HTTP door', async () => {
  const { w, ids, apollo } = build();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, op: 'link', field: 'Project', targets: [apollo.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.done, ids);
    assert.equal(w.readEntity(apollo.id).fields.Tasks.length, 3);
  } finally { server.close(); }
});

test('weave_bulk is the MCP door and takes every parameter the engine takes', () => {
  const { w, ids } = build();
  const tool = TOOLS.find((t) => t.name === 'weave_bulk');
  assert.ok(tool, 'weave_bulk is listed');
  for (const k of ['ids', 'op', 'values', 'field', 'targets', 'table', 'name']) {
    assert.ok(tool.inputSchema.properties[k], `weave_bulk takes ${k}`);
  }
  const r = dispatchTool(w, 'weave_bulk', { ids, op: 'set', values: { Kind: 'Feature' } });
  assert.deepEqual(r.done, ids);
  assert.equal(w.readEntity(ids[1]).fields.Kind, 'Feature');
});

test('weave bulk is the CLI door', () => {
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-bulk-'));
  const data = join(dir, 'ws.db');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
  try {
    cli('space', 'create', 'Work');
    cli('table', 'create', 'Work', 'Task');
    cli('field', 'add', 'Task', 'Estimate', 'number');
    cli('create', 'Task', 'One');
    cli('create', 'Task', 'Two');
    const r = JSON.parse(cli('bulk', 'set', 'Task#1', 'Task#2', '--values', '{"Estimate":7}'));
    assert.equal(r.done.length, 2);
    assert.deepEqual(r.failed, []);
    assert.equal(JSON.parse(cli('get', 'Task#2')).fields.Estimate, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
