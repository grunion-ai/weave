import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createServer } from '../src/server.js';

/* The universal reference rule (Kyle, 2026-08-24): every entity — the
   workspace itself, spaces, tables, rows — is REFERENCED by its unique id
   and carries an id-based permalink. Names are display labels: rename
   anything and every stored reference and every permalink still resolves.
   This is what makes the model extensible — new kinds get durable identity
   for free by following the same rule. */

const listen = (srv) => new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
const req = async (port, path, opts = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text };
};

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

test('the workspace itself has a unique id, minted once and kept forever', () => {
  const w = fresh();
  const id = w.state.meta.id;
  assert.match(id, /^[0-9a-f-]{36}$/, 'a uuid');
  // The id survives the interchange format and a rename.
  const json = w.exportJSON();
  const w2 = new Weave();
  w2.importJSON(json);
  assert.equal(w2.state.meta.id, id, 'import keeps the identity');
  w2.state.meta.name = 'renamed';
  assert.equal(w2.state.meta.id, id, 'a rename never touches it');
  // A legacy workspace without one grows one on load.
  delete json.meta.id;
  const w3 = new Weave();
  w3.importJSON(json);
  assert.match(w3.state.meta.id, /^[0-9a-f-]{36}$/);
});

test('every level answers to its id and reports an id-based permalink', () => {
  const w = fresh();
  const space = w.getSpace('Dev');
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });

  // ids resolve regardless of names…
  w.updateSpace(space.id, { name: 'Engineering' });
  w.updateTable(db.id, { name: 'Story' });
  w.updateEntity(row.id, { Name: 'ship it' });
  assert.equal(w.getSpace(space.id).name, 'Engineering');
  assert.equal(w.getTable(db.id).name, 'Story');
  assert.equal(w.readEntity(row.id).name, 'ship it');

  // …and every read carries the permalink, built from the id alone.
  assert.equal(w.readEntity(row.id).url, `/e/${row.id}`);
  const schema = w.describeSchema();
  const sp = schema.find((x) => x.spaceId === space.id);
  assert.equal(sp.url, `#/space/${space.id}`);
  const tb = sp.tables.find((x) => x.id === db.id);
  assert.equal(tb.url, `#/table/${db.id}`);
});

test('GET /api/workspace exposes the id and its permalink', async () => {
  const srv = createServer(fresh());
  const port = await listen(srv);
  try {
    const { json } = await req(port, '/api/workspace');
    assert.match(json.id, /^[0-9a-f-]{36}$/);
    assert.equal(json.url, `/w/${json.id}/`, 'the canonical workspace permalink is id-based');
  } finally { srv.close(); }
});

test('/w/<workspace-id>/ routes to the workspace, before and after a rename', async () => {
  const w = fresh();
  const srv = createServer(w);
  const port = await listen(srv);
  try {
    const id = w.state.meta.id;
    const byId = await req(port, `/w/${id}/api/workspace`);
    assert.equal(byId.status, 200);
    assert.equal(byId.json.id, id);

    // Rename through the API: the name alias moves, the id URL never does.
    const oldName = w.state.meta.name;
    await req(port, '/api/workspace', { method: 'PATCH', body: JSON.stringify({ name: 'renamedws' }) });
    const still = await req(port, `/w/${id}/api/workspace`);
    assert.equal(still.status, 200, 'the id permalink survives the rename');
    assert.equal(still.json.name, 'renamedws');
    const newAlias = await req(port, '/w/renamedws/api/workspace');
    assert.equal(newAlias.status, 200, 'the friendly name still works as an alias');
    assert.notEqual(oldName, 'renamedws');
  } finally { srv.close(); }
});

test('the workspace list carries ids and id-based urls', async () => {
  const srv = createServer(fresh());
  const port = await listen(srv);
  try {
    const { json } = await req(port, '/api/workspaces');
    for (const ws of json) {
      assert.match(ws.id, /^[0-9a-f-]{36}$/, `${ws.name} has an id`);
      assert.equal(ws.url, `/w/${ws.id}/`, `${ws.name} advertises its id permalink`);
    }
  } finally { srv.close(); }
});

test('mentions resolve by id, so a rename never breaks a document', () => {
  const w = fresh();
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });
  const doc = w.createEntity(db.id, { Name: 'notes' });
  w.setDoc(doc.id, `See [[${row.id}]] and [[table:${db.id}]] and [[space:${w.getSpace('Dev').id}]].`);

  const before = w.readEntity(doc.id);
  // Rename everything the mentions point at.
  w.updateEntity(row.id, { Name: 'ship it' });
  w.updateTable(db.id, { name: 'Story' });
  w.updateSpace('Dev', { name: 'Engineering' });

  // The doc text is untouched (ids), and resolution follows the renames.
  assert.equal(w.readEntity(doc.id).docs.Description, before.docs.Description);
  const html = w.renderDoc ? null : null; // resolution is exercised through the server below
});

test('the server renders id mentions as live links with the CURRENT names', async () => {
  const w = fresh();
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });
  const srv = createServer(w);
  const port = await listen(srv);
  try {
    const doc = w.createEntity(db.id, { Name: 'notes' });
    w.setDoc(doc.id, `See [[${row.id}]] and [[table:${db.id}]].`);
    w.updateEntity(row.id, { Name: 'renamed row' });
    w.updateTable(db.id, { name: 'Story' });
    const { text } = await req(port, `/e/${doc.id}/doc.html`);
    assert.match(text, /renamed row/, 'the entity mention shows the current name');
    assert.match(text, /Story/, 'the table mention shows the current name');
    assert.match(text, new RegExp(row.id), 'and links by id');
  } finally { srv.close(); }
});
