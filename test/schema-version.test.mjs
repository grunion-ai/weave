import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { Weave } from '../src/engine.js';

const AMBER = '#f59f00';

const seeded = () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Deals' });
  w.addField('Sales/Deals', { name: 'Stage', type: 'select', config: { options: [{ name: 'Open', color: '' }] } });
  return w;
};

test('schemaVersion is a stable fingerprint of the structure', () => {
  const w = seeded();
  const v = w.schemaVersion();
  assert.match(v, /^[0-9a-f]{8,}$/, 'a short hex fingerprint');
  assert.equal(w.schemaVersion(), v, 'asking twice does not move it');
});

test('a field-config change moves schemaVersion', () => {
  const w = seeded();
  const before = w.schemaVersion();
  w.updateField('Sales/Deals', 'Stage', { config: { options: [{ name: 'Open', color: AMBER }] } });
  assert.notEqual(w.schemaVersion(), before, 'recolouring an option is exactly the change #274 lost');
});

test('renaming a table, adding a field and adding a space each move schemaVersion', () => {
  const w = seeded();
  const a = w.schemaVersion();
  w.addField('Sales/Deals', { name: 'Value', type: 'number' });
  const b = w.schemaVersion();
  assert.notEqual(b, a, 'a new column');
  w.updateTable('Sales/Deals', { name: 'Pipeline' });
  const c = w.schemaVersion();
  assert.notEqual(c, b, 'a renamed table');
  w.createSpace({ name: 'Ops' });
  assert.notEqual(w.schemaVersion(), c, 'a new space');
});

test('entity writes leave schemaVersion alone', () => {
  const w = seeded();
  const before = w.schemaVersion();
  const e = w.createEntity('Sales/Deals', { Name: 'Acme' });
  w.updateEntity(e.id, { Name: 'Acme Corp' });
  w.deleteEntity(e.id);
  assert.equal(w.schemaVersion(), before, 'rows move constantly; the structure did not');
});

test('every API response stamps the schema version, and /api/workspace carries it in the body', async () => {
  const w = seeded();
  const { server, port } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/tables/Sales%2FDeals/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const stamped = res.headers.get('x-weave-schema-version');
    assert.equal(stamped, w.schemaVersion(), 'the row query the tab already makes carries the version');

    const ws = await (await fetch(`${base}/api/workspace`)).json();
    assert.equal(ws.schemaVersion, w.schemaVersion(), 'and an agent can read it without a header');

    w.updateField('Sales/Deals', 'Stage', { config: { options: [{ name: 'Open', color: AMBER }] } });
    const after = await fetch(`${base}/api/schema`);
    assert.equal(after.headers.get('x-weave-schema-version'), w.schemaVersion(), 'the fresh schema names the version it is');
    assert.notEqual(after.headers.get('x-weave-schema-version'), stamped, 'and it is not the one the tab was holding');
  } finally {
    server.close();
  }
});
