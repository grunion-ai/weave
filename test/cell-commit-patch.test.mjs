/* The blast radius of one write (Issue #257).

   Every cell commit used to re-read the whole table: PATCH, GET, then the
   table query again, and a redraw that threw the grid away. The server
   already knows which rows a write touched, so the PATCH says so and the
   client patches those rows in place.

   This suite pins the server half: `affected` on the PATCH response, and
   `["id","in",[…]]` as the read that goes with it. The DOM half is in
   test/cell-commit-patch-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

let base, server, weave;
let cases, suites, suiteA, suiteB, caseA, caseB, loose;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  weave = new Weave();
  weave.createSpace({ name: 'Quality' });
  suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(cases, { name: 'Note', type: 'text' });
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  // A lookup is the reason a row that was NOT written can go stale: Case
  // shows the Suite's name, so renaming the Suite changes what Case paints.
  weave.addField(cases, { name: 'Suite name', type: 'lookup', config: { relationField: 'Suite', targetField: 'Name' } });
  suiteA = weave.createEntity(suites, { name: 'engine' });
  suiteB = weave.createEntity(suites, { name: 'viewer' });
  caseA = weave.createEntity(cases, { name: 'case a', values: { Suite: suiteA.id } });
  caseB = weave.createEntity(cases, { name: 'case b', values: { Suite: suiteA.id } });
  loose = weave.createEntity(cases, { name: 'case c' });
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('a plain field edit on an unlinked row names only that row', async () => {
  const res = await api('PATCH', `/api/entities/${loose.id}`, { values: { Note: 'hello' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.fields.Note, 'hello', 'the PATCH still answers with the fresh row');
  assert.deepEqual(res.data.affected, [loose.id], `same-row edit, same-row blast radius: ${JSON.stringify(res.data.affected)}`);
});

/* A linked row's own links ride along: a rollup on the Suite can aggregate
   the very field just written, and it recomputes on read. The grid pays
   nothing for the extra id — it patches the rows IT is showing and drops
   the rest — and a Suite left stale is the bug this Issue is about. */
test('a plain field edit on a linked row names its far side too', async () => {
  const res = await api('PATCH', `/api/entities/${caseA.id}`, { values: { Note: 'hello' } });
  assert.deepEqual(new Set(res.data.affected), new Set([caseA.id, suiteA.id]),
    `the row and the Suite it hangs from: ${JSON.stringify(res.data.affected)}`);
});

test('a name edit names the rows whose lookups reach it', async () => {
  const res = await api('PATCH', `/api/entities/${suiteA.id}`, { values: { Name: 'engine core' } });
  assert.equal(res.status, 200);
  const got = new Set(res.data.affected);
  assert.ok(got.has(suiteA.id), 'the edited row');
  assert.ok(got.has(caseA.id) && got.has(caseB.id), `its two linked Cases: ${JSON.stringify(res.data.affected)}`);
  assert.ok(!got.has(loose.id), 'and no row it cannot reach');
  assert.ok(!got.has(suiteB.id), 'nor the sibling Suite');
});

test('a relation edit names both sides', async () => {
  const res = await api('PATCH', `/api/entities/${loose.id}`, { values: { Suite: suiteB.id } });
  assert.equal(res.status, 200);
  const got = new Set(res.data.affected);
  assert.ok(got.has(loose.id), 'the row written');
  assert.ok(got.has(suiteB.id), `the Suite it was linked to: ${JSON.stringify(res.data.affected)}`);
});

test('a write that changes nothing still names the row it was asked about', async () => {
  const res = await api('PATCH', `/api/entities/${caseA.id}`, { values: { Note: 'hello' } });
  assert.ok(res.data.affected.includes(caseA.id), 'a no-op write still answers for the row');
  assert.equal(res.data.affected.length, 2, `and names nothing beyond its own link: ${JSON.stringify(res.data.affected)}`);
});

test('the client\'s read is one query: ["id","in",[…]]', async () => {
  const res = await api('POST', `/api/tables/${cases.id}/query`, { where: [['id', 'in', [caseA.id, caseB.id]]] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.items.map((i) => i.id).sort(), [caseA.id, caseB.id].sort());
  assert.equal(res.data.items[0].fields['Suite name'], 'engine core', 'and the lookup comes back recomputed');
});
