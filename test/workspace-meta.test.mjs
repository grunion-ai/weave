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

/* Feature #40 — per-table entity noun. A table of invoices holds invoices,
   not "entities": the noun is table schema, lands in describeSchema, and the
   UI's create affordances speak it. */
test('a table can name what its rows are', () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Invoices' });
  w.updateTable('Invoices', { noun: 'invoice' });
  const t = w.describeSchema().find((sp) => sp.space === 'Sales').tables[0];
  assert.equal(t.noun, 'invoice');
  assert.throws(() => w.updateTable('Invoices', { noun: 42 }), /noun/i);
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
