/* The nav kebab's two structural verbs (Kyle, 2026-08-31): move a table to
   another space, and duplicate a table deep — every field with its full
   config, relations rebuilt as real paired fields (self-relations retargeted
   into the copy), lookups/rollups re-pointed at the copy's own relation
   fields, and the name auto-suffixed " Copy" (" Copy 2", …) until free.
   Duplicate copies SCHEMA, not rows: the copy starts empty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

const build = () => {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createSpace({ name: 'Archive' });
  const tasks = w.createTable({ space: 'Product', name: 'Task', icon: 'lucide:square-check', description: 'Work items' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  return { w, tasks, projects };
};

/* ---------------- move to space ---------------- */

test('moveTable moves the table into the target space', () => {
  const { w, tasks } = build();
  const moved = w.moveTable(tasks.id, 'Archive');
  assert.equal(moved.spaceId, w.getSpace('Archive').id);
  assert.equal(w.qualifiedName(moved), 'Archive/Task');
});

test('moveTable keeps entities exactly where they are', () => {
  const { w, tasks } = build();
  const e = w.createEntity(tasks.id, { name: 'Ship it' });
  w.moveTable(tasks.id, 'Archive');
  assert.equal(w.listEntities(tasks.id).length, 1);
  assert.equal(w.readEntity(e.id).name, 'Ship it');
});

test('moveTable to the current space is a no-op', () => {
  const { w, tasks } = build();
  const before = tasks.spaceId;
  const moved = w.moveTable(tasks.id, 'Product');
  assert.equal(moved.spaceId, before);
});

test('moveTable refuses a live name clash in the destination', () => {
  const { w, tasks } = build();
  w.createTable({ space: 'Archive', name: 'Task' });
  assert.throws(() => w.moveTable(tasks.id, 'Archive'), /already/i);
});

test('moveTable refuses a clash with a trashed table in the destination', () => {
  const { w, tasks } = build();
  const ghost = w.createTable({ space: 'Archive', name: 'Task' });
  w.deleteTable(ghost.id);
  assert.throws(() => w.moveTable(tasks.id, 'Archive'), /trash/i);
});

test('moveTable refuses system tables and unknown spaces', () => {
  const { w, tasks } = build();
  const registry = w.findTable('Workspace/Tables');
  if (registry) assert.throws(() => w.moveTable(registry.id, 'Archive'), /system/i);
  assert.throws(() => w.moveTable(tasks.id, 'Nowhere'), /not found/i);
  assert.throws(() => w.moveTable(tasks.id, 'Workspace'), /system/i, 'the registry space takes no tenants');
});

test('moveTable re-links the registry Tables row to the new Space row', () => {
  const { w, tasks } = build();
  w.moveTable(tasks.id, 'Archive');
  const tablesT = w.findTable('Workspace/Tables');
  const row = w.listEntities(tablesT.id).find((r) => r.sysId === tasks.id);
  const spaceF = w.findField(tablesT, 'Space');
  assert.ok(spaceF, 'registry keeps a Space relation');
  const linked = w.readEntity(row.id).raw['Space'];
  const archiveRow = w.listEntities(w.findTable('Workspace/Spaces').id)
    .find((r) => r.sysId === w.getSpace('Archive').id);
  assert.ok(linked.includes(archiveRow.id), 'Tables row points at the Archive space row');
});

/* ---------------- duplicate: naming ---------------- */

test('duplicate lands in the same space as "<name> Copy"', () => {
  const { w, tasks } = build();
  const copy = w.duplicateTable(tasks.id);
  assert.equal(copy.name, 'Task Copy');
  assert.equal(copy.spaceId, tasks.spaceId);
  assert.equal(w.qualifiedName(copy), 'Product/Task Copy');
});

test('duplicate auto-increments when Copy names are taken (live or trashed)', () => {
  const { w, tasks } = build();
  const first = w.duplicateTable(tasks.id);
  assert.equal(first.name, 'Task Copy');
  const second = w.duplicateTable(tasks.id);
  assert.equal(second.name, 'Task Copy 2');
  w.deleteTable(second.id); // trashed still holds the name
  const third = w.duplicateTable(tasks.id);
  assert.equal(third.name, 'Task Copy 3');
});

test('duplicate carries description and icon, resets ids and counters', () => {
  const { w, tasks } = build();
  const copy = w.duplicateTable(tasks.id);
  assert.equal(copy.description, 'Work items');
  assert.equal(copy.icon, 'lucide:square-check');
  assert.notEqual(copy.id, tasks.id);
  assert.equal(copy.publicIdCounter, 0);
});

/* ---------------- duplicate: field config, deep ---------------- */

test('duplicate copies every field with its full config, deeply (no shared objects)', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
  w.addField(tasks, { name: 'Estimate', type: 'number', config: { unit: 'pt', width: 120 } });
  const copy = w.duplicateTable(tasks.id);
  const srcPrio = w.findField(w.getTable(tasks.id), 'Priority');
  const cpPrio = w.findField(copy, 'Priority');
  assert.ok(cpPrio && cpPrio.id !== srcPrio.id, 'same name, fresh id');
  assert.deepEqual(
    cpPrio.config.options.map((o) => o.name ?? o),
    srcPrio.config.options.map((o) => o.name ?? o));
  const cpEst = w.findField(copy, 'Estimate');
  assert.equal(cpEst.config.unit, 'pt');
  assert.equal(cpEst.config.width, 120);
  // Deep, not shared: renaming an option on the copy leaves the source alone.
  cpPrio.config.options[0].name = 'P9';
  assert.notEqual(srcPrio.config.options[0].name, 'P9');
});

test('duplicate preserves workflow states, the default flag, and field order', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'State', type: 'workflow', config: { states: [{ name: 'Open' }, { name: 'Doing' }, { name: 'Done', final: true }] } });
  const src = w.getTable(tasks.id);
  const copy = w.duplicateTable(tasks.id);
  const cpState = w.findField(copy, 'State');
  assert.deepEqual(cpState.config.states.map((s) => s.name), ['Open', 'Doing', 'Done']);
  assert.ok(cpState.config.states.some((s) => s.default), 'a default state survives');
  assert.deepEqual(
    copy.fieldOrder.map((id) => copy.fields[id].name),
    src.fieldOrder.map((id) => src.fields[id].name));
});

test('duplicate remaps the Name and Description roles onto its own fields', () => {
  const { w, tasks } = build();
  const copy = w.duplicateTable(tasks.id);
  assert.ok(copy.fields[copy.nameFieldId], 'nameFieldId points into the copy');
  assert.equal(copy.fields[copy.nameFieldId].name, 'Name');
  assert.ok(copy.fields[copy.descriptionFieldId], 'descriptionFieldId points into the copy');
  assert.notEqual(copy.nameFieldId, tasks.nameFieldId);
});

test('duplicate keeps a deleted description role deleted (null tombstone)', () => {
  const { w, tasks } = build();
  w.deleteField(tasks.id, 'Description');
  const copy = w.duplicateTable(tasks.id);
  assert.equal(copy.descriptionFieldId, null);
});

/* ---------------- duplicate: relations ---------------- */

test('duplicate rebuilds an external relation with its own inverse on the target', () => {
  const { w, tasks, projects } = build();
  const { field: rel } = w.addRelation(tasks.id, { name: 'Project', targetDb: projects.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const copy = w.duplicateTable(tasks.id);
  const cpRel = w.findField(copy, 'Project');
  assert.equal(cpRel.type, 'relation');
  assert.equal(cpRel.config.targetDb, projects.id, 'still points at Project');
  assert.notEqual(cpRel.id, rel.id);
  const target = w.getTable(projects.id);
  const inverse = target.fields[cpRel.config.inverseFieldId];
  assert.ok(inverse, 'target grew a fresh inverse field');
  assert.equal(inverse.config.targetDb, copy.id, 'inverse points at the copy');
  assert.equal(inverse.config.inverseFieldId, cpRel.id, 'wired both ways');
  assert.notEqual(inverse.id, rel.config.inverseFieldId, 'the original inverse is untouched');
  assert.match(inverse.name, /^Tasks Copy/, 'inverse auto-renamed past the clash');
  // Source pair untouched.
  assert.equal(w.findField(w.getTable(tasks.id), 'Project').config.inverseFieldId,
    rel.config.inverseFieldId);
});

test('duplicate retargets a self-relation into the copy', () => {
  const { w, tasks } = build();
  w.addRelation(tasks.id, { name: 'Parent', targetDb: tasks.id, cardinality: 'many-to-one', inverseName: 'Subtasks' });
  const copy = w.duplicateTable(tasks.id);
  const cpParent = w.findField(copy, 'Parent');
  const cpSubs = w.findField(copy, 'Subtasks');
  assert.equal(cpParent.config.targetDb, copy.id, 'Parent points at the copy, not the source');
  assert.equal(cpSubs.config.targetDb, copy.id);
  assert.equal(cpParent.config.inverseFieldId, cpSubs.id);
  assert.equal(cpSubs.config.inverseFieldId, cpParent.id);
  // Source self-relation still closed over the source.
  const srcParent = w.findField(w.getTable(tasks.id), 'Parent');
  assert.equal(srcParent.config.targetDb, tasks.id);
});

test('duplicate carries a one-way target-set relation as-is', () => {
  const { w, tasks, projects } = build();
  const spacesT = w.findTable('Workspace/Spaces');
  w.addRelation(tasks.id, { name: 'About', targetDbs: [projects.id, spacesT.id], cardinality: 'many-to-many' });
  const copy = w.duplicateTable(tasks.id);
  const cpAbout = w.findField(copy, 'About');
  assert.deepEqual(cpAbout.config.targetDbs, [projects.id, spacesT.id]);
  assert.equal(cpAbout.config.inverseFieldId, undefined, 'stays one-way');
});

/* ---------------- duplicate: lookups, rollups, formulas ---------------- */

test('duplicate re-points lookups and rollups at the copy’s own relation field', () => {
  const { w, tasks, projects } = build();
  w.addField(projects, { name: 'Budget', type: 'number' });
  const { field: rel } = w.addRelation(tasks.id, { name: 'Project', targetDb: projects.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(tasks, { name: 'Project Budget', type: 'lookup', config: { relationField: rel.id, targetField: 'Budget' } });
  w.addField(tasks, { name: 'Sibling Count', type: 'rollup', config: { relationField: rel.id, aggregate: 'count' } });
  const copy = w.duplicateTable(tasks.id);
  const cpRel = w.findField(copy, 'Project');
  const cpLookup = w.findField(copy, 'Project Budget');
  const cpRollup = w.findField(copy, 'Sibling Count');
  assert.equal(cpLookup.config.relationField, cpRel.id, 'lookup follows the copied relation');
  assert.equal(cpRollup.config.relationField, cpRel.id, 'rollup follows the copied relation');
  const budget = w.findField(w.getTable(projects.id), 'Budget');
  assert.equal(cpLookup.config.targetField, budget.id, 'target field on the far table is unchanged');
});

test('duplicate carries a formula field’s expression and costume', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, { name: 'Double', type: 'formula', config: { expression: '[Estimate] * 2', decimals: 1 } });
  const copy = w.duplicateTable(tasks.id);
  const cpF = w.findField(copy, 'Double');
  assert.equal(cpF.config.expression, '[Estimate] * 2');
  assert.equal(cpF.config.decimals, 1);
});

/* ---------------- duplicate: boundaries ---------------- */

test('duplicate copies schema, never rows — the copy starts empty', () => {
  const { w, tasks } = build();
  w.createEntity(tasks.id, { name: 'One' });
  w.createEntity(tasks.id, { name: 'Two' });
  const copy = w.duplicateTable(tasks.id);
  assert.equal(w.listEntities(copy.id).length, 0);
  assert.equal(w.listEntities(tasks.id).length, 2, 'the source keeps its rows');
});

test('duplicate refuses system tables', () => {
  const { w } = build();
  const registry = w.findTable('Workspace/Tables');
  assert.throws(() => w.duplicateTable(registry.id), /system/i);
});

test('duplicate registers the copy in the Tables registry', () => {
  const { w, tasks } = build();
  const copy = w.duplicateTable(tasks.id);
  const tablesT = w.findTable('Workspace/Tables');
  const row = w.listEntities(tablesT.id).find((r) => r.sysId === copy.id);
  assert.ok(row, 'the copy has a registry row');
  assert.equal(w.entityName(row), 'Task Copy');
});

/* ---------------- trash is not a home (review, 2026-09-02) ---------------- */

test('moveTable refuses a trashed table and a trashed destination space', () => {
  const { w, tasks } = build();
  w.deleteTable(tasks.id);
  assert.throws(() => w.moveTable(tasks.id, 'Archive'), /trash/i, 'an id finds a trashed table — it still cannot move');
  w.restoreTable(tasks.id);
  const archive = w.getSpace('Archive');
  w.deleteSpace(archive.id);
  assert.throws(() => w.moveTable(tasks.id, archive.id), /trash/i, 'a trashed space is not a destination');
  assert.equal(w.getTable(tasks.id).spaceId, w.getSpace('Product').id, 'nothing moved');
});

test('duplicateTable refuses a trashed source', () => {
  const { w, tasks } = build();
  w.deleteTable(tasks.id);
  assert.throws(() => w.duplicateTable(tasks.id), /trash/i);
  assert.equal(w.listTables().filter((d) => !d.system).length, 1, 'no copy was born');
});

/* ---------------- parity: routes ---------------- */

const withServer = async (fn) => {
  const { w, tasks, projects } = build();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  try { await fn({ w, tasks, projects, call }); } finally { server.close(); }
};

test('POST /api/tables/:id/move re-homes the table; a missing or bad destination is refused', async () => {
  await withServer(async ({ w, tasks, call }) => {
    const moved = await call('POST', `/api/tables/${tasks.id}/move`, { space: 'Archive' });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.spaceId, w.getSpace('Archive').id);
    const bare = await call('POST', `/api/tables/${tasks.id}/move`, {});
    assert.equal(bare.status, 400, 'no destination is a bad request, not a "space undefined not found"');
    assert.match(bare.data.error, /space/i);
    assert.equal((await call('POST', `/api/tables/${tasks.id}/move`, { space: 'Nowhere' })).status, 404);
    w.createTable({ space: 'Product', name: 'Task' });
    assert.equal((await call('POST', `/api/tables/${tasks.id}/move`, { space: 'Product' })).status, 409, 'a name clash is a conflict');
  });
});

test('POST /api/tables/:id/duplicate answers 201 with the copy', async () => {
  await withServer(async ({ w, tasks, call }) => {
    const r = await call('POST', `/api/tables/${tasks.id}/duplicate`);
    assert.equal(r.status, 201);
    assert.equal(r.data.name, 'Task Copy');
    assert.ok(w.getTable(r.data.id), 'the copy is real');
    const registry = w.findTable('Workspace/Tables');
    assert.equal((await call('POST', `/api/tables/${registry.id}/duplicate`)).status, 400, 'system tables refuse');
  });
});

test('move and duplicate are schema writes: a writer token is refused, an admin passes', async () => {
  await withServer(async ({ w, tasks, call }) => {
    const { token: writer } = w.createAccount({ name: 'bot', role: 'writer' });
    const { token: admin } = w.createAccount({ name: 'root', role: 'admin' });
    assert.equal((await call('POST', `/api/tables/${tasks.id}/move`, { space: 'Archive' }, writer)).status, 403);
    assert.equal((await call('POST', `/api/tables/${tasks.id}/duplicate`, undefined, writer)).status, 403);
    assert.equal(w.getTable(tasks.id).spaceId, w.getSpace('Product').id, 'and nothing moved');
    assert.equal((await call('POST', `/api/tables/${tasks.id}/duplicate`, undefined, admin)).status, 201);
    assert.equal((await call('POST', `/api/tables/${tasks.id}/move`, { space: 'Archive' }, admin)).status, 200);
  });
});

/* ---------------- parity: MCP ---------------- */

test('MCP lists weave_move_table and weave_duplicate_table, and dispatches them to the engine', () => {
  const move = TOOLS.find((t) => t.name === 'weave_move_table');
  const dup = TOOLS.find((t) => t.name === 'weave_duplicate_table');
  assert.deepEqual(move.inputSchema.required, ['db', 'space']);
  assert.deepEqual(dup.inputSchema.required, ['db']);
  const { w, tasks } = build();
  const moved = dispatchTool(w, 'weave_move_table', { db: 'Product/Task', space: 'Archive' });
  assert.equal(moved.spaceId, w.getSpace('Archive').id);
  const copy = dispatchTool(w, 'weave_duplicate_table', { db: tasks.id });
  assert.equal(copy.name, 'Task Copy');
  assert.equal(w.qualifiedName(copy), 'Archive/Task Copy', 'the copy lands beside its source, wherever that now is');
  assert.throws(() => dispatchTool(w, 'weave_move_table', { db: 'Archive/Task', space: 'Workspace' }), /system/i);
});

/* ---------------- parity: CLI ---------------- */

test('CLI: `table move` and `table duplicate` reach the engine, and the usage line names them', () => {
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-kebab-'));
  const data = join(dir, 'ws.json');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
  try {
    cli('space', 'create', 'Product');
    cli('space', 'create', 'Archive');
    cli('table', 'create', 'Product', 'Task');
    const moved = JSON.parse(cli('table', 'move', 'Product/Task', 'Archive'));
    assert.equal(moved.name, 'Task');
    const copy = JSON.parse(cli('table', 'duplicate', 'Archive/Task'));
    assert.equal(copy.name, 'Task Copy');
    assert.equal(copy.spaceId, moved.spaceId);
    assert.throws(() => cli('table', 'bogus', 'Archive/Task'), /move, duplicate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
