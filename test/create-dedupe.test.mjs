import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

function tracker() {
  const w = new Weave();
  w.createSpace({ name: 'Development' });
  const t = w.createTable({ space: 'Development', name: 'Issue' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Fixed', category: 'done' }] } });
  w.addField(t.id, { name: 'Severity', type: 'text' });
  const fixed = w.createEntity(t.id, { name: 'Slow: the grid stalls on paste' });
  w.setState(fixed.id, 'Status', 'Fixed');
  const open = w.createEntity(t.id, { name: 'Error: export drops the header' });
  return { w, t, fixed, open };
}

const file = (fetch, body) => fetch('/api/tables/Issue/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (res) => ({ status: res.status, json: await res.json() }));
const rows = (w, t) => w.listEntities(t.id).length;

test('POST /api/tables/:db/entities with dedupe answers 409 and the existing row when a Fixed row holds the name', async () => {
  const { w, t, fixed } = tracker();
  await withServer(w, async ({ fetch }) => {
    const r = await file(fetch, { Name: 'Slow: the grid stalls on paste', Severity: 'High', dedupe: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'conflict');
    assert.equal(r.json.entity.id, fixed.id, 'the answer carries the row that already holds the name');
    assert.equal(r.json.entity.publicId, fixed.publicId);
    assert.equal(r.json.entity.fields.Status, 'Fixed', 'a Fixed row still holds its name');
    assert.match(r.json.error, new RegExp(`#${fixed.publicId}\\b`), 'the refusal names the row to update instead');
    assert.equal(rows(w, t), 2, 'nothing was created');
  });
});

test('dedupe matches the name ignoring case and surrounding spaces, in every shape a create sends it', async () => {
  const { w, t, open } = tracker();
  await withServer(w, async ({ fetch }) => {
    for (const body of [
      { Name: '  error: EXPORT drops the header ', dedupe: true },
      { name: 'Error: export drops the header', dedupe: true },
      { values: { Name: 'ERROR: export drops the header' }, dedupe: true },
    ]) {
      const r = await file(fetch, body);
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.equal(r.json.entity.id, open.id, JSON.stringify(body));
    }
    assert.equal(rows(w, t), 2);
  });
});

test('dedupe with no row of that name creates the row, and dedupe is not a field', async () => {
  const { w, t } = tracker();
  await withServer(w, async ({ fetch }) => {
    const r = await file(fetch, { Name: 'Gap: bulk edits have no undo', Severity: 'Low', dedupe: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.name, 'Gap: bulk edits have no undo');
    assert.equal(r.json.fields.Severity, 'Low');
    assert.equal(r.json.fields.Status, 'Open');
    assert.equal(rows(w, t), 3);
  });
});

test('without dedupe, or with dedupe false, a second row of the same name is created as before', async () => {
  const { w, t } = tracker();
  await withServer(w, async ({ fetch }) => {
    assert.equal((await file(fetch, { Name: 'Slow: the grid stalls on paste' })).status, 201);
    assert.equal((await file(fetch, { Name: 'Slow: the grid stalls on paste', dedupe: false })).status, 201);
    assert.equal(rows(w, t), 4);
  });
});

test('a row in the trash does not hold its name against dedupe', async () => {
  const { w, t, open } = tracker();
  w.deleteEntity(open.id);
  await withServer(w, async ({ fetch }) => {
    const r = await file(fetch, { Name: 'Error: export drops the header', dedupe: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.notEqual(r.json.id, open.id);
    assert.equal(rows(w, t), 2);
  });
});

test('dedupe takes true or false, and needs a name to match on', async () => {
  const { w, t } = tracker();
  await withServer(w, async ({ fetch }) => {
    const word = await file(fetch, { Name: 'Slow: the grid stalls on paste', dedupe: 'yes' });
    assert.equal(word.status, 400);
    assert.equal(word.json.code, 'invalid');
    assert.match(word.json.error, /dedupe/);
    const nameless = await file(fetch, { Severity: 'Low', dedupe: true });
    assert.equal(nameless.status, 400);
    assert.equal(nameless.json.code, 'invalid');
    assert.match(nameless.json.error, /name/);
    assert.equal(rows(w, t), 2);
  });
});
