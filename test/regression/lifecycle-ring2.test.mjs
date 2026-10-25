import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';
import { tempDir } from '../lib/temp.mjs';

const scratch = () => tempDir('weave-ring2-');

const reopen = (w) => {
  const path = w.store.path;
  w.store.close();
  return new Weave({ path });
};

const ftsIds = (path, word) => {
  const db = new DatabaseSync(path);
  try {
    return db.prepare('SELECT id FROM entities_fts WHERE entities_fts MATCH ?').all(word).map((r) => r.id);
  } finally {
    db.close();
  }
};

const rowCount = (path, dbId) => {
  const db = new DatabaseSync(path);
  try {
    return db.prepare('SELECT count(*) AS n FROM entities WHERE db_id = ?').get(dbId).n;
  } finally {
    db.close();
  }
};

const api = (base) => async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const yard = (path) => {
  const w = new Weave({ path });
  w.createSpace({ name: 'Yard' });
  const anchor = w.createTable({ space: 'Yard', name: 'Anchor' });
  const load = w.createTable({ space: 'Yard', name: 'Load' });
  w.addRelation(load, { name: 'Anchor', targetDb: anchor, cardinality: 'many-to-one', inverseName: 'Loads' });
  const home = w.createEntity(anchor, { name: 'Home' });
  const cargo = w.createEntity(load, { name: 'Cargo', doc: 'zephyr manifest', values: { Anchor: home.id } });
  return { w, anchor, load, home, cargo };
};

test('ring 2 reopen: entity delete and restore hold across a sqlite close and reopen', () => {
  const dir = scratch();
  try {
    let { w, load, cargo } = yard(join(dir, 'ws.db'));
    w.deleteEntity(cargo.id);
    w = reopen(w);
    assert.equal(w.query(load.id, {}).total, 0);
    assert.equal(w.search('Cargo').length, 0);
    assert.ok(w.readEntity(cargo.id).deletedAt, 'the trashed row reloads as trashed');
    assert.ok(w.listTrash(load.id).some((e) => e.id === cargo.id));
    w.restoreEntity(cargo.id);
    w = reopen(w);
    assert.equal(w.readEntity(cargo.id).deletedAt, null);
    assert.equal(w.readEntity(cargo.id).publicId, cargo.publicId);
    assert.equal(w.search('Cargo').length, 1);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 reopen: table delete and restore hold across a sqlite close and reopen', () => {
  const dir = scratch();
  try {
    let { w, load, home, cargo } = yard(join(dir, 'ws.db'));
    w.deleteTable(load.id);
    w = reopen(w);
    assert.ok(!w.listTables().some((d) => d.id === load.id));
    assert.equal(w.findTable('Yard/Load'), undefined);
    assert.equal(w.search('Cargo').length, 0);
    assert.deepEqual(w.readEntity(home.id).fields.Loads, [], 'relations stay closed to the trash after a reopen');
    assert.equal(w.readEntity(cargo.id).name, 'Cargo');
    w.restoreTable(load.id);
    w = reopen(w);
    assert.equal(w.getTable('Yard/Load').deletedAt, null);
    assert.equal(w.query(load.id, {}).total, 1);
    assert.equal(w.readEntity(home.id).fields.Loads.length, 1, 'the relation comes back with the table');
    assert.equal(w.readEntity(cargo.id).fields.Anchor.id ?? w.readEntity(cargo.id).fields.Anchor, home.id);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 reopen: space delete and restore hold across a sqlite close and reopen', () => {
  const dir = scratch();
  try {
    let { w, load, cargo } = yard(join(dir, 'ws.db'));
    const space = w.getSpace('Yard');
    w.deleteSpace(space.id);
    w = reopen(w);
    assert.equal(w.findSpace('Yard'), undefined);
    assert.ok(!w.listTables().some((d) => d.id === load.id));
    assert.equal(w.search('Cargo').length, 0);
    assert.equal(w.readEntity(cargo.id).name, 'Cargo');
    w.restoreSpace(space.id);
    w = reopen(w);
    assert.ok(w.findSpace('Yard'));
    assert.equal(w.query('Yard/Load', {}).total, 1);
    assert.equal(w.search('Cargo').length, 1);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 reopen: workspace delete and restore hold across a server restart', async () => {
  const dir = scratch();
  const boot = async () => {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.state.meta.name = 'main';
    main.save();
    const { server } = await startServer(main, { port: 0 });
    return { server, call: api(`http://127.0.0.1:${server.address().port}`) };
  };
  let run = await boot();
  try {
    assert.equal((await run.call('POST', '/api/workspaces', { name: 'probe' })).status, 201);
    assert.equal((await run.call('DELETE', '/api/workspaces/probe')).status, 200);
    run.server.close();
    run = await boot();
    assert.ok(!(await run.call('GET', '/api/workspaces')).data.some((w) => w.name === 'probe'), 'the trash outlives the restart');
    assert.ok((await run.call('GET', '/api/workspaces?deleted=1')).data.find((w) => w.name === 'probe')?.deletedAt);
    assert.equal((await run.call('POST', '/api/workspaces/probe/restore')).status, 200);
    run.server.close();
    run = await boot();
    assert.ok((await run.call('GET', '/api/workspaces')).data.some((w) => w.name === 'probe' && !w.deletedAt), 'the restore outlives the restart');
  } finally {
    run.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 purge: an entity soft-deleted then purged is gone from rows, trash and the index', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    let { w, load, cargo } = yard(path);
    w.deleteEntity(cargo.id);
    w.deleteEntity(cargo.id, { hard: true });
    w = reopen(w);
    assert.throws(() => w.getEntity(cargo.id), { code: 'not-found' });
    assert.ok(!w.listTrash(load.id).some((e) => e.id === cargo.id));
    assert.equal(rowCount(path, load.id), 0);
    assert.deepEqual(ftsIds(path, 'zephyr'), []);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 purge: a table soft-deleted then purged takes its rows and inverse field, and frees its name', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    let { w, anchor, load, cargo } = yard(path);
    w.deleteTable(load.id);
    w.deleteTable(load.id, { hard: true });
    w = reopen(w);
    assert.equal(w.findTable(load.id), undefined);
    assert.throws(() => w.restoreTable(load.id), { code: 'not-found' });
    assert.throws(() => w.getEntity(cargo.id), { code: 'not-found' });
    assert.equal(rowCount(path, load.id), 0);
    assert.equal(w.findField(w.getTable(anchor.id), 'Loads'), undefined, 'the inverse relation goes with the purged table');
    assert.ok(w.createTable({ space: 'Yard', name: 'Load' }), 'the purged name is free again');
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 purge: a space soft-deleted then purged takes every table and row, and frees its name', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    let { w, anchor, load, home, cargo } = yard(path);
    const space = w.getSpace('Yard');
    w.deleteSpace(space.id);
    w.deleteSpace(space.id, { hard: true });
    w = reopen(w);
    assert.ok(!w.listSpaces({ includeDeleted: true }).some((s) => s.id === space.id));
    assert.throws(() => w.restoreSpace(space.id), { code: 'not-found' });
    for (const t of [anchor, load]) assert.equal(w.findTable(t.id), undefined);
    for (const e of [home, cargo]) assert.throws(() => w.getEntity(e.id), { code: 'not-found' });
    assert.equal(rowCount(path, load.id) + rowCount(path, anchor.id), 0);
    assert.ok(w.createSpace({ name: 'Yard' }), 'the purged name is free again');
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 purge: a workspace soft-deleted then purged leaves the hub and frees its slug', async () => {
  const dir = scratch();
  const main = new Weave({ path: join(dir, 'main.db') });
  main.state.meta.name = 'main';
  main.save();
  const { server } = await startServer(main, { port: 0 });
  const call = api(`http://127.0.0.1:${server.address().port}`);
  try {
    assert.equal((await call('POST', '/api/workspaces', { name: 'probe' })).status, 201);
    assert.equal((await call('DELETE', '/api/workspaces/probe')).status, 200);
    assert.equal((await call('DELETE', '/api/workspaces/probe?hard=1')).status, 200);
    assert.ok(!(await call('GET', '/api/workspaces?deleted=1')).data.some((w) => w.name === 'probe'));
    assert.equal(existsSync(join(dir, 'probe.db')), false, 'the file left the data directory');
    assert.ok(readdirSync(join(dir, 'trash')).some((f) => f.startsWith('probe-') && f.endsWith('.db')), 'and sits in trash/');
    assert.equal((await call('POST', '/api/workspaces/probe/restore')).status, 404);
    assert.equal((await call('POST', '/w/probe/api/spaces', { name: 'Leftover' })).status, 404, 'the purged workspace no longer answers');
    assert.equal((await call('POST', '/api/workspaces', { name: 'probe' })).status, 201, 'the slug is free again');
    assert.equal((await call('POST', '/api/workspaces', { name: 'fresh' })).status, 201);
    const listed = (await call('GET', '/api/workspaces')).data;
    const shape = (name) => { const w = listed.find((x) => x.name === name); return { spaces: w.spaces, tables: w.tables, entities: w.entities }; };
    assert.deepEqual(shape('probe'), shape('fresh'), 'and opens as fresh as a new workspace');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 name conflict: a trashed table cannot restore over a live table that took its name', () => {
  const dir = scratch();
  try {
    let { w, anchor, load } = yard(join(dir, 'ws.db'));
    w.deleteTable(load.id);
    assert.throws(() => w.createTable({ space: 'Yard', name: 'Load' }), { code: 'conflict' });
    w.updateTable(anchor.id, { name: 'Load' });
    w = reopen(w);
    assert.throws(() => w.restoreTable(load.id), { code: 'conflict' });
    w = reopen(w);
    assert.ok(w.getTable(load.id).deletedAt, 'the refused restore left the table in the trash');
    assert.equal(w.getTable('Yard/Load').id, anchor.id, 'and the live table kept its name');
    w.updateTable(anchor.id, { name: 'Anchor' });
    w.restoreTable(load.id);
    assert.equal(w.query(load.id, {}).total, 1);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 name conflict: a trashed space cannot restore over a live space that took its name', () => {
  const dir = scratch();
  try {
    let { w, load } = yard(join(dir, 'ws.db'));
    const space = w.getSpace('Yard');
    const other = w.createSpace({ name: 'Dock' });
    w.deleteSpace(space.id);
    assert.throws(() => w.createSpace({ name: 'Yard' }), { code: 'conflict' });
    w.updateSpace(other.id, { name: 'Yard' });
    w = reopen(w);
    assert.throws(() => w.restoreSpace(space.id), { code: 'conflict' });
    w = reopen(w);
    assert.ok(w.getSpace(space.id).deletedAt);
    assert.equal(w.getSpace('Yard').id, other.id);
    w.updateSpace(other.id, { name: 'Dock' });
    w.restoreSpace(space.id);
    assert.equal(w.query(load.id, {}).total, 1);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 name conflict: the HTTP restore answers 409 and the trashed workspace slug stays held', async () => {
  const dir = scratch();
  const main = new Weave({ path: join(dir, 'main.db') });
  main.state.meta.name = 'main';
  main.save();
  const { server } = await startServer(main, { port: 0 });
  const call = api(`http://127.0.0.1:${server.address().port}`);
  try {
    assert.equal((await call('POST', '/api/workspaces', { name: 'probe' })).status, 201);
    assert.equal((await call('POST', '/api/workspaces', { name: 'other' })).status, 201);
    assert.equal((await call('POST', '/w/other/api/spaces', { name: 'Yard' })).status, 201);
    const a = (await call('POST', '/w/other/api/tables', { space: 'Yard', name: 'Load' })).data;
    const b = (await call('POST', '/w/other/api/tables', { space: 'Yard', name: 'Spare' })).data;
    assert.equal((await call('DELETE', `/w/other/api/tables/${a.id}`)).status, 200);
    assert.equal((await call('PATCH', `/w/other/api/tables/${b.id}`, { name: 'Load' })).status, 200);
    assert.equal((await call('POST', `/w/other/api/tables/${a.id}/restore`)).status, 409);
    assert.equal((await call('DELETE', '/api/workspaces/probe')).status, 200);
    assert.equal((await call('POST', '/api/workspaces', { name: 'probe' })).status, 409, 'a new workspace cannot take a trashed slug');
    assert.equal((await call('PATCH', '/w/other/api/workspace', { name: 'probe' })).status, 409, 'nor can a rename');
    assert.equal((await call('POST', '/api/workspaces/probe/restore')).status, 200);
    assert.ok((await call('GET', '/api/workspaces')).data.some((w) => w.name === 'probe'));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 undo: structural trash and restore leave the undo stack alone', () => {
  const dir = scratch();
  try {
    let { w, load, cargo } = yard(join(dir, 'ws.db'));
    w.updateEntity(cargo.id, { name: 'Cargo two' });
    const before = w.listUndo({ limit: 50 });
    const space = w.getSpace('Yard');
    w.deleteTable(load.id);
    w.restoreTable(load.id);
    w.deleteSpace(space.id);
    w.restoreSpace(space.id);
    assert.deepEqual(w.listUndo({ limit: 50 }), before, 'no structural op lands on the stack');
    w = reopen(w);
    assert.deepEqual(w.listUndo({ limit: 50 }), before, 'and the stack reloads as it was');
    const { undone } = w.undo();
    assert.equal(undone[0].kind, 'update');
    assert.equal(w.readEntity(cargo.id).name, 'Cargo', 'undo reaches the row edit, not the table');
    assert.equal(w.getTable(load.id).deletedAt, null);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 undo: undoing a row delete inside a trashed table keeps the row hidden until the table returns', () => {
  const dir = scratch();
  try {
    let { w, load, cargo } = yard(join(dir, 'ws.db'));
    w.deleteEntity(cargo.id);
    w.deleteTable(load.id);
    const depth = w.listUndo({ limit: 50 }).length;
    w = reopen(w);
    assert.equal(w.undo().undone[0].kind, 'delete');
    assert.equal(w.listUndo({ limit: 50 }).length, depth - 1, 'the undo pushed nothing back');
    assert.ok(w.getTable(load.id).deletedAt, 'undo did not restore the table');
    assert.equal(w.search('Cargo').length, 0, 'the row is live but its table is not');
    w = reopen(w);
    w.restoreTable(load.id);
    assert.equal(w.search('Cargo').length, 1);
    assert.equal(w.query(load.id, {}).total, 1);
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 undo: undoing a row create after its table was purged skips cleanly', () => {
  const dir = scratch();
  try {
    let { w, load } = yard(join(dir, 'ws.db'));
    w.createEntity(load, { name: 'Late' });
    w.deleteTable(load.id);
    w.deleteTable(load.id, { hard: true });
    w = reopen(w);
    const { undone } = w.undo();
    assert.equal(undone[0].kind, 'create');
    assert.equal(undone[0].skipped, 'entity purged');
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 search: live rows under a trashed table or space are delisted from every search path, and come back on restore', async () => {
  const dir = scratch();
  const path = join(dir, 'main.db');
  try {
    let { w, load, cargo } = yard(path);
    w.state.meta.name = 'main';
    w.save();
    const space = w.getSpace('Yard');
    const hidden = (x) => {
      assert.equal(x.search('zephyr').length, 0, 'engine search');
      assert.ok(!x.universalSearch('zephyr').some((h) => h.id === cargo.id), 'universal search');
      assert.ok(!x.universalSearch('', { tables: [load.id] }).some((h) => h.id === cargo.id), 'scoped browse of the trashed table');
      assert.ok(!x.universalSearch('zephyr', { tables: [load.id] }).some((h) => h.id === cargo.id), 'scoped search of the trashed table');
    };
    for (const [trash, restore] of [[() => w.deleteTable(load.id), () => w.restoreTable(load.id)], [() => w.deleteSpace(space.id), () => w.restoreSpace(space.id)]]) {
      trash();
      hidden(w);
      w = reopen(w);
      hidden(w);
      assert.deepEqual(ftsIds(path, 'zephyr'), [cargo.id], 'the index keeps the live row; the container filter delists it at read time');
      const { server } = await startServer(w, { port: 0 });
      try {
        const call = api(`http://127.0.0.1:${server.address().port}`);
        const { data } = await call('GET', '/api/search?q=zephyr');
        assert.ok(!data.some((h) => h.id === cargo.id), 'HTTP search');
        const scoped = await call('GET', `/api/search?q=&tables=${load.id}`);
        assert.ok(!(scoped.data ?? []).some((h) => h.id === cargo.id), 'HTTP scoped browse');
      } finally {
        server.close();
      }
      restore();
      w = reopen(w);
      assert.equal(w.search('zephyr').length, 1, 'restore relists without reindexing');
      assert.ok(w.universalSearch('', { tables: [load.id] }).some((h) => h.id === cargo.id));
    }
    w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ring 2 concurrency: CLI and server writes around delete and restore meet through the per-request refresh', async () => {
  const dir = scratch();
  const path = join(dir, 'main.db');
  const seeded = yard(path);
  const { anchor, load, home, cargo } = seeded;
  seeded.w.state.meta.name = 'main';
  seeded.w.save();
  seeded.w.store.close();
  const served = new Weave({ path });
  const { server } = await startServer(served, { port: 0 });
  const call = api(`http://127.0.0.1:${server.address().port}`);
  const cli = (fn) => {
    const w = new Weave({ path });
    try { return fn(w); } finally { w.store.close(); }
  };
  try {
    cli((w) => w.deleteTable(load.id));
    assert.ok(!(await call('GET', '/api/tables')).data.some((t) => t.id === load.id), 'server sees the CLI trash');
    assert.equal((await call('POST', `/api/tables/${anchor.id}/entities`, { name: 'Pier' })).status, 201);
    cli((w) => assert.ok(w.getTable(load.id).deletedAt, 'a server write elsewhere did not resurrect the table'));

    assert.equal((await call('POST', `/api/tables/${load.id}/restore`)).status, 200);
    cli((w) => {
      assert.equal(w.getTable(load.id).deletedAt, null, 'CLI sees the server restore');
      assert.equal(w.readEntity(home.id).fields.Loads.length, 1);
    });

    assert.equal((await call('DELETE', `/api/spaces/${load.spaceId}`)).status, 200);
    cli((w) => {
      assert.equal(w.findSpace('Yard'), undefined, 'CLI sees the server space trash');
      w.updateEntity(cargo.id, { name: 'Cargo edited' });
    });
    assert.equal((await call('GET', '/api/spaces')).data.some((s) => s.id === load.spaceId), false, 'a CLI row write did not resurrect the space');
    cli((w) => w.restoreSpace(load.spaceId));
    assert.ok((await call('GET', '/api/spaces')).data.some((s) => s.id === load.spaceId), 'server sees the CLI restore');

    cli((w) => w.deleteEntity(cargo.id));
    assert.ok((await call('GET', `/api/entities/${cargo.id}`)).data.deletedAt, 'server sees the CLI row delete');
    assert.equal((await call('POST', `/api/entities/${cargo.id}/restore`)).status, 200);
    cli((w) => {
      assert.equal(w.readEntity(cargo.id).deletedAt, null, 'CLI sees the server row restore');
      assert.equal(w.readEntity(cargo.id).name, 'Cargo edited', 'and keeps the CLI edit made while the space was trashed');
    });

    const stale = new Weave({ path });
    try {
      assert.equal((await call('DELETE', `/api/tables/${load.id}`)).status, 200);
      assert.equal(stale.maybeRefresh(), true, 'a long-lived engine notices the external trash');
      assert.ok(stale.getTable(load.id).deletedAt);
      stale.createEntity(anchor, { name: 'Quay' });
    } finally {
      stale.store.close();
    }
    assert.ok(!(await call('GET', '/api/tables')).data.some((t) => t.id === load.id), 'the refreshed engine kept the trash');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
