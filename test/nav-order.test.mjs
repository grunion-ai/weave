import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const userSpaces = (w) => w.listSpaces().filter((s) => !s.system).map((s) => s.name);
const tablesIn = (w, space) => w.listTables(w.getSpace(space).id).map((t) => t.name);

const build = () => {
  const w = new Weave();
  for (const name of ['Alpha', 'Bravo', 'Charlie']) w.createSpace({ name });
  for (const name of ['One', 'Two', 'Three']) w.createTable({ space: 'Alpha', name });
  w.createTable({ space: 'Bravo', name: 'Solo' });
  return w;
};

const tempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-nav-order-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('spaces and tables list in creation order, and a new one lands last (Feature #284)', () => {
  const w = build();
  assert.deepEqual(userSpaces(w), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(tablesIn(w, 'Alpha'), ['One', 'Two', 'Three']);
  w.createSpace({ name: 'Delta' });
  w.createTable({ space: 'Alpha', name: 'Four' });
  assert.deepEqual(userSpaces(w), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(tablesIn(w, 'Alpha'), ['One', 'Two', 'Three', 'Four']);
  const positions = w.listSpaces().map((s) => s.position);
  assert.ok(positions.every(Number.isInteger), 'every space carries a stored position');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'in list order');
});

test('updateSpace {position} moves a space; 0 is the first place (Feature #284)', () => {
  const w = build();
  const first = w.listSpaces()[0].name;
  w.updateSpace('Charlie', { position: 0 });
  assert.deepEqual(w.listSpaces().map((s) => s.name).slice(0, 2), ['Charlie', first]);
  assert.deepEqual(userSpaces(w), ['Charlie', 'Alpha', 'Bravo']);
  w.updateSpace('Charlie', { position: 99 });
  assert.deepEqual(userSpaces(w), ['Alpha', 'Bravo', 'Charlie'], 'a position past the end lands last');
  assert.deepEqual(w.listSpaces().map((s) => s.position), w.listSpaces().map((_, i) => i), 'positions stay dense');
});

test('updateTable {position} moves a table inside its space (Feature #284)', () => {
  const w = build();
  w.updateTable('Alpha/Three', { position: 0 });
  assert.deepEqual(tablesIn(w, 'Alpha'), ['Three', 'One', 'Two']);
  w.updateTable('Alpha/Three', { position: 1 });
  assert.deepEqual(tablesIn(w, 'Alpha'), ['One', 'Three', 'Two']);
  assert.deepEqual(tablesIn(w, 'Bravo'), ['Solo'], 'the other space is untouched');
});

test('listTables() walks the spaces in order, then each space in its own order (Feature #284)', () => {
  const w = build();
  w.updateSpace('Bravo', { position: 0 });
  w.updateTable('Alpha/Two', { position: 0 });
  const user = w.listTables().filter((t) => !t.system).map((t) => w.qualifiedName(t));
  assert.deepEqual(user, ['Bravo/Solo', 'Alpha/Two', 'Alpha/One', 'Alpha/Three']);
});

test('a position must be a whole number at or past 0 (Feature #284)', () => {
  const w = build();
  for (const bad of [-1, 1.5, 'first']) {
    assert.throws(() => w.updateSpace('Alpha', { position: bad }), /position is a whole number/);
    assert.throws(() => w.updateTable('Alpha/One', { position: bad }), /position is a whole number/);
    assert.throws(() => w.moveTable('Alpha/One', 'Bravo', { position: bad }), /position is a whole number/);
  }
  assert.deepEqual(userSpaces(w), ['Alpha', 'Bravo', 'Charlie'], 'nothing moved');
});

test('moveTable lands last in the new space, or at the position it is given (Feature #284)', () => {
  const w = build();
  w.moveTable('Alpha/Two', 'Bravo');
  assert.deepEqual(tablesIn(w, 'Bravo'), ['Solo', 'Two']);
  assert.deepEqual(tablesIn(w, 'Alpha'), ['One', 'Three']);
  w.moveTable('Alpha/Three', 'Bravo', { position: 0 });
  assert.deepEqual(tablesIn(w, 'Bravo'), ['Three', 'Solo', 'Two']);
  w.moveTable('Bravo/Two', 'Bravo', { position: 0 });
  assert.deepEqual(tablesIn(w, 'Bravo'), ['Two', 'Three', 'Solo'], 'a move to its own space with a position reorders it');
  w.moveTable('Bravo/Two', 'Bravo');
  assert.deepEqual(tablesIn(w, 'Bravo'), ['Two', 'Three', 'Solo'], 'and without one it stays put');
});

test('a duplicate lands last in its space; a trashed table keeps its place for its restore (Feature #284)', () => {
  const w = build();
  w.duplicateTable('Alpha/One');
  assert.deepEqual(tablesIn(w, 'Alpha'), ['One', 'Two', 'Three', 'One Copy']);
  w.deleteTable('Alpha/Two');
  w.updateTable('Alpha/Three', { position: 0 });
  assert.deepEqual(tablesIn(w, 'Alpha'), ['Three', 'One', 'One Copy']);
  w.restoreTable(w.listTables(w.getSpace('Alpha').id, { includeDeleted: true }).find((t) => t.name === 'Two').id);
  assert.deepEqual(tablesIn(w, 'Alpha'), ['Three', 'One', 'Two', 'One Copy'], 'Two comes back after One, where it sat');
});

test('the order survives a reload from disk (Feature #284)', () => tempDir((dir) => {
  const path = join(dir, 'ws.db');
  const w = new Weave({ path });
  for (const name of ['Alpha', 'Bravo', 'Charlie']) w.createSpace({ name });
  for (const name of ['One', 'Two', 'Three']) w.createTable({ space: 'Alpha', name });
  w.updateSpace('Charlie', { position: 0 });
  w.updateTable('Alpha/Three', { position: 0 });
  w.store.close?.();
  const again = new Weave({ path });
  assert.deepEqual(userSpaces(again), ['Charlie', 'Alpha', 'Bravo']);
  assert.deepEqual(tablesIn(again, 'Alpha'), ['Three', 'One', 'Two']);
  again.store.close?.();
}));

test('a workspace saved before positions existed keeps today\'s order as its starting order (Feature #284)', () => tempDir((dir) => {
  const path = join(dir, 'old.db');
  const w = new Weave({ path });
  for (const name of ['Zulu', 'Alpha', 'Mike']) w.createSpace({ name });
  for (const name of ['Kilo', 'Bravo', 'Echo']) w.createTable({ space: 'Zulu', name });
  const today = w.listSpaces().map((s) => s.name);
  w.store.close?.();
  const raw = new DatabaseSync(path);
  for (const kind of ['spaces', 'tables']) {
    for (const row of raw.prepare(`SELECT id, json FROM ${kind}`).all()) {
      const obj = JSON.parse(row.json);
      delete obj.position;
      raw.prepare(`UPDATE ${kind} SET json = ? WHERE id = ?`).run(JSON.stringify(obj), row.id);
    }
  }
  raw.close();
  const again = new Weave({ path });
  assert.deepEqual(again.listSpaces().map((s) => s.name), today, 'the spaces read in the order they were made');
  assert.deepEqual(tablesIn(again, 'Zulu'), ['Kilo', 'Bravo', 'Echo']);
  assert.ok(again.listSpaces().every((s) => Number.isInteger(s.position)), 'the migration stored a position on every space');
  assert.ok(again.listTables().every((t) => Number.isInteger(t.position)), 'and on every table');
  again.store.close?.();
}));

const hub = () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const members = {};
  for (const name of ['alpha', 'beta', 'gamma']) {
    const w = new Weave();
    w.updateWorkspace({ name });
    members[name] = w;
  }
  return { root, members };
};

test('workspaces: the hub order is the stored order, and moveWorkspace rewrites it from any member (Feature #284)', () => {
  const { root, members } = hub();
  const h = createWorkspaceHub(root, { workspaces: members });
  const names = () => h.list().map((x) => x.name);
  assert.deepEqual(names(), ['root', 'alpha', 'beta', 'gamma'], 'today\'s order is the starting order');
  assert.deepEqual(root.workspaceOrder().map((x) => x.name), names(), 'the engine reads the same order');
  root.moveWorkspace('gamma', 1);
  assert.deepEqual(names(), ['root', 'gamma', 'alpha', 'beta']);
  members.beta.moveWorkspace('alpha', 3);
  assert.deepEqual(names(), ['root', 'gamma', 'beta', 'alpha'], 'a member writes the order on the hub root');
  assert.deepEqual(members.gamma.workspaceOrder().map((x) => x.name), names());
  assert.throws(() => root.moveWorkspace('nowhere', 0), /not found/);
  assert.throws(() => root.moveWorkspace('beta', -2), /position is a whole number/);
});

test('workspaces: the order survives a hub restart (Feature #284)', () => tempDir((dir) => {
  const open = () => {
    const root = new Weave({ path: join(dir, 'root.db') });
    root.updateWorkspace({ name: 'root' });
    return { root, h: createWorkspaceHub(root) };
  };
  for (const name of ['alpha', 'beta', 'gamma']) {
    const w = new Weave({ path: join(dir, `${name}.db`) });
    w.updateWorkspace({ name });
    w.store.close?.();
  }
  let { root, h } = open();
  assert.deepEqual(h.list().map((x) => x.name), ['root', 'alpha', 'beta', 'gamma']);
  root.moveWorkspace('gamma', 0);
  const want = h.list().map((x) => x.name);
  assert.deepEqual(want, ['gamma', 'root', 'alpha', 'beta']);
  for (const [, w] of h.entries()) w.store.close?.();
  ({ root, h } = open());
  assert.deepEqual(h.list().map((x) => x.name), want);
  for (const [, w] of h.entries()) w.store.close?.();
}));

const withServer = async (fn) => {
  const { root, members } = hub();
  root.createSpace({ name: 'Alpha' });
  root.createSpace({ name: 'Bravo' });
  for (const name of ['One', 'Two', 'Three']) root.createTable({ space: 'Alpha', name });
  const { server } = await startServer(root, { port: 0, workspaces: members });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  try { await fn({ root, members, call }); } finally { server.close(); }
};

test('REST reads and writes the order of spaces, tables and workspaces (Feature #284)', async () => {
  await withServer(async ({ root, call }) => {
    assert.equal((await call('PATCH', `/api/spaces/Bravo`, { position: 0 })).status, 200);
    const spaces = (await call('GET', '/api/spaces')).data;
    assert.equal(spaces[0].name, 'Bravo', 'GET /api/spaces answers in order');
    assert.equal(spaces[0].position, 0);
    assert.equal((await call('PATCH', `/api/tables/${root.getTable('Alpha/Three').id}`, { position: 0 })).status, 200);
    const tables = (await call('GET', '/api/tables?space=Alpha')).data;
    assert.deepEqual(tables.map((t) => t.name), ['Three', 'One', 'Two']);
    assert.deepEqual(tables.map((t) => t.position), [0, 1, 2]);
    const moved = await call('POST', `/api/tables/${root.getTable('Alpha/One').id}/move`, { space: 'Bravo', position: 0 });
    assert.equal(moved.status, 200);
    assert.deepEqual((await call('GET', '/api/tables?space=Bravo')).data.map((t) => t.name), ['One']);
    const schema = (await call('GET', '/api/schema')).data;
    assert.deepEqual(schema.filter((s) => !s.system).map((s) => s.space), ['Bravo', 'Alpha'], 'the schema the sidebar draws is in order');
    assert.equal((await call('PATCH', `/api/spaces/Alpha`, { position: -1 })).status, 400);

    const ws = await call('PATCH', '/api/workspaces/gamma', { position: 0 });
    assert.equal(ws.status, 200, JSON.stringify(ws.data));
    assert.deepEqual((await call('GET', '/api/workspaces')).data.map((x) => x.name), ['gamma', 'root', 'alpha', 'beta']);
    assert.equal((await call('PATCH', '/api/workspaces/gamma', {})).status, 400, 'a position is required');
    assert.equal((await call('PATCH', '/api/workspaces/nowhere', { position: 0 })).status, 404);
  });
});

test('a writer token cannot reorder spaces, tables or workspaces (Feature #284)', async () => {
  await withServer(async ({ root, call }) => {
    const { token: writer } = root.createAccount({ name: 'bot', role: 'writer' });
    assert.equal((await call('PATCH', '/api/spaces/Bravo', { position: 0 }, writer)).status, 403);
    assert.equal((await call('PATCH', `/api/tables/${root.getTable('Alpha/Three').id}`, { position: 0 }, writer)).status, 403);
    assert.equal((await call('PATCH', '/api/workspaces/root', { position: 1 }, writer)).status, 403);
    assert.deepEqual(userSpaces(root), ['Alpha', 'Bravo'], 'nothing moved');
    assert.deepEqual(tablesIn(root, 'Alpha'), ['One', 'Two', 'Three']);
  });
});

test('MCP reads and writes the same order through the same engine calls (Feature #284)', () => {
  const props = (name) => Object.keys(TOOLS.find((t) => t.name === name).inputSchema.properties);
  for (const name of ['weave_update_space', 'weave_update_table', 'weave_move_table', 'weave_workspace']) {
    assert.ok(props(name).includes('position'), `${name} takes position`);
  }
  const { root, members } = hub();
  createWorkspaceHub(root, { workspaces: members });
  root.createSpace({ name: 'Alpha' });
  root.createSpace({ name: 'Bravo' });
  for (const name of ['One', 'Two']) root.createTable({ space: 'Alpha', name });
  dispatchTool(root, 'weave_update_space', { space: 'Bravo', position: 0 });
  dispatchTool(root, 'weave_update_table', { db: 'Alpha/Two', position: 0 });
  const schema = dispatchTool(root, 'weave_schema', {}).filter((s) => !s.system);
  assert.deepEqual(schema.map((s) => s.space), ['Bravo', 'Alpha']);
  assert.deepEqual(schema[1].tables.map((t) => t.name), ['Two', 'One']);
  dispatchTool(root, 'weave_move_table', { db: 'Alpha/One', space: 'Bravo', position: 0 });
  assert.deepEqual(tablesIn(root, 'Bravo'), ['One']);
  const moved = dispatchTool(members.alpha, 'weave_workspace', { action: 'move', name: 'beta', position: 0 });
  assert.deepEqual(moved.workspaces.map((x) => x.name), ['beta', 'root', 'alpha', 'gamma']);
  const read = dispatchTool(root, 'weave_workspace', { action: 'order' });
  assert.deepEqual(read.workspaces.map((x) => x.name), ['beta', 'root', 'alpha', 'gamma']);
});

test('CLI reads and writes the same order (Feature #284)', () => tempDir((dir) => {
  const data = join(dir, 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' }));
  for (const name of ['Alpha', 'Bravo']) cli('space', 'create', name);
  for (const name of ['One', 'Two', 'Three']) cli('table', 'create', 'Alpha', name);
  cli('space', 'update', 'Bravo', '--position', '0');
  assert.deepEqual(cli('space', 'list').filter((s) => !s.system).map((s) => s.name), ['Bravo', 'Alpha']);
  cli('table', 'update', 'Alpha/Three', '--position', '0');
  cli('table', 'move', 'Alpha/Two', 'Bravo', '--position', '0');
  assert.deepEqual(cli('table', 'list').filter((n) => !n.startsWith('Workspace/')), ['Bravo/Two', 'Alpha/Three', 'Alpha/One']);
  const order = cli('workspace', 'order');
  assert.equal(order.length, 1, 'a lone workspace file is its own registry');
  assert.equal(order[0].position, 0);
  const hubDir = join(dir, 'hub');
  mkdirSync(hubDir);
  const root = new Weave({ path: join(hubDir, 'root.db') });
  root.updateWorkspace({ name: 'root' });
  const beta = new Weave({ path: join(hubDir, 'beta.db') });
  beta.updateWorkspace({ name: 'beta' });
  createWorkspaceHub(root, { workspaces: { beta } });
  root.store.close?.();
  beta.store.close?.();
  const onRoot = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', join(hubDir, 'root.db')], { encoding: 'utf8' }));
  assert.deepEqual(onRoot('workspace', 'order').map((x) => x.name), ['root', 'beta']);
  assert.deepEqual(onRoot('workspace', 'move', 'beta', '--position', '0').map((x) => x.name), ['beta', 'root']);
  assert.deepEqual(onRoot('workspace', 'order').map((x) => x.name), ['beta', 'root']);
}));
