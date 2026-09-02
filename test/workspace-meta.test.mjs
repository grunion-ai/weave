import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

test('describeSchema carries space and table descriptions', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops', description: 'Operations space' });
  w.createTable({ space: 'Ops', name: 'Runbook', description: 'How we run things' });
  const schema = w.describeSchema();
  const ops = schema.find((sp) => sp.space === 'Ops');
  assert.equal(ops.description, 'Operations space');
  assert.equal(ops.tables[0].description, 'How we run things');
});

test('GET/PATCH /api/workspace: name + description, hub re-keys on rename', async () => {
  const w = new Weave();
  w.state.meta.name = 'uno';
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (r) => r.json();
  try {
    const before = await j(await fetch(`${base}/api/workspace`));
    assert.equal(before.name, 'uno');

    const patched = await j(await fetch(`${base}/api/workspace`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'The **main** workspace', name: 'primary' }),
    }));
    assert.equal(patched.name, 'primary');
    assert.equal(patched.description, 'The **main** workspace');

    // Hub now serves the workspace under the new name (it was the default).
    const list = await j(await fetch(`${base}/api/workspaces`));
    assert.ok(list.find((x) => x.name === 'primary' && x.default));
    assert.ok(!list.find((x) => x.name === 'uno'));
    const health = await j(await fetch(`${base}/api/health`));
    assert.equal(health.workspace, 'primary');
  } finally {
    server.close();
  }
});

test('POST /api/markdown renders markdown to html', async () => {
  const w = new Weave();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/markdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md: '# Hi\n\nsome **bold** text' }),
    });
    const { html } = await res.json();
    assert.match(html, /<h1[^>]*>Hi<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
  } finally {
    server.close();
  }
});

test('API responses carry no CORS allow-origin header (same-origin only)', async () => {
  const w = new Weave();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  } finally {
    server.close();
  }
});

/* Feature #40 — what one row is called. A table of invoices holds invoices,
   not "entities". Since 2026-09-02 the term is Name-field config
   (`config.term = { singular, plural }`), so it rides the one field every table
   keeps; `noun` stays as the alias the CLI and MCP already speak. */
test('a table can name what its rows are', () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const db = w.createTable({ space: 'Sales', name: 'Invoices' });
  assert.deepEqual(w.termOf(db), { singular: 'record', plural: 'records', set: false }, 'the default is record');
  w.updateTable('Invoices', { noun: 'invoice' });
  const t = w.describeSchema().find((sp) => sp.space === 'Sales').tables[0];
  assert.equal(t.noun, 'invoice', 'the alias still reads back');
  assert.deepEqual(t.term, { singular: 'invoice', plural: 'invoices', set: true });
  assert.deepEqual(t.fields.find((f) => f.name === 'Name').term, { singular: 'invoice', plural: 'invoices' }, 'and it is Name-field config');
  assert.equal(w.getTable(db.id).noun, undefined, 'nothing lands on the table itself');
  assert.throws(() => w.updateTable('Invoices', { noun: 42 }), /noun/i);
});

test('the term is set on the Name field, with a plural you can correct, and cleared with null', () => {
  const w = new Weave();
  w.createSpace({ name: 'HR' });
  const db = w.createTable({ space: 'HR', name: 'Staff' });
  const nameField = Object.values(db.fields).find((f) => f.name === 'Name');
  w.updateField(db.id, nameField.id, { config: { term: { singular: ' Person ' } } });
  assert.deepEqual(w.termOf(db.id), { singular: 'person', plural: 'people', set: true }, 'lowercased, trimmed, irregular plural known');
  w.updateField(db.id, nameField.id, { config: { term: { singular: 'person', plural: 'staff' } } });
  assert.equal(w.termOf(db.id).plural, 'staff');
  assert.equal(w.describeSchema().find((sp) => sp.space === 'HR').tables[0].noun, 'person', 'the alias is the singular');
  assert.throws(() => w.updateField(db.id, nameField.id, { config: { term: { singular: '' } } }), /1–32/);
  const other = w.addField(db.id, { name: 'Role', type: 'text' });
  assert.throws(() => w.updateField(db.id, other.id, { config: { term: { singular: 'x' } } }), /Name field/);
  w.updateField(db.id, nameField.id, { config: { term: null } });
  assert.equal(w.termOf(db.id).set, false, 'null clears back to the default');
  w.updateTable(db.id, { noun: 'person' });
  w.updateTable(db.id, { noun: '' });
  assert.equal(w.termOf(db.id).set, false, 'an empty noun clears too');
});

test('registry tables speak their kind: a row of Fields is a field', () => {
  const w = new Weave();
  const kinds = Object.fromEntries(w.listTables().filter((t) => t.system).map((t) => [t.system, w.termOf(t)]));
  assert.deepEqual(kinds.fields, { singular: 'field', plural: 'fields', set: false });
  assert.deepEqual(kinds.spaces, { singular: 'space', plural: 'spaces', set: false });
  assert.deepEqual(kinds.tables, { singular: 'table', plural: 'tables', set: false });
  assert.deepEqual(kinds.workflows, { singular: 'workflow', plural: 'workflows', set: false });
});

test('a legacy workspace noun moves onto the Name field on first open', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Runs' });
  const doc = w.exportJSON();
  const legacy = Object.values(doc.tables).find((t) => t.name === 'Runs');
  legacy.noun = 'run';
  const fresh = new Weave();
  fresh.importJSON(doc);
  const db = fresh.getTable('Ops/Runs');
  assert.equal(db.noun, undefined, 'the table key is gone');
  assert.deepEqual(fresh.termOf(db), { singular: 'run', plural: 'runs', set: true });
});

/* Feature #51 — the workspace's shape as a read-only .mmd. One generator in
   the engine; the home page and any doc that wants the map consume the same
   source. User structure only — the registry describes itself. */
test('relationMapMmd draws spaces, tables and relations', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.createTable({ space: 'Dev', name: 'Project' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one' });
  const mmd = w.relationMapMmd();
  assert.match(mmd, /^graph LR/);
  assert.match(mmd, /subgraph "Dev"/);
  assert.match(mmd, /\["Task"\]/);
  assert.match(mmd, /-- "Project" -->/);
  assert.ok(!mmd.includes('Spaces'), 'the registry stays out of the picture');
});

/* Feature #101 — spaces and tables carry an icon, edited beside their name. */
test('spaces and tables carry an icon through the schema', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Runbook' });
  w.updateSpace('Ops', { icon: 'iconly:setting' });
  w.updateTable('Runbook', { icon: 'iconly:document' });
  const sch = w.describeSchema().find((sp) => sp.space === 'Ops');
  assert.equal(sch.icon, 'iconly:setting');
  assert.equal(sch.tables[0].icon, 'iconly:document');
  w.updateSpace('Ops', { icon: '' });
  assert.equal(w.describeSchema().find((sp) => sp.space === 'Ops').icon, undefined, 'empty clears');
});
