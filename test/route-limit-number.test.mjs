import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  const rows = [0, 1, 2].map((i) => w.createEntity(t.id, { Name: `t${i}` }));
  return { w, t, rows };
}

async function serve(w) {
  const { server } = await startServer(w, { port: 0 });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const count = (payload) => (Array.isArray(payload) ? payload.length : payload.items?.length);

test('a query-string limit that is not a number is a 400 naming limit, never a silently empty page (Issue #1354)', async () => {
  const { w, t, rows } = demo();
  const { server, base } = await serve(w);
  try {
    const paths = [
      '/api/audit?limit=lots',
      '/api/undo?limit=lots',
      `/api/tables/${t.id}/entities?limit=lots`,
      `/api/entities/${rows[0].id}/doc/revisions?limit=lots`,
    ];
    for (const p of paths) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 400, `${p} answers 400`);
      const body = await res.json();
      assert.equal(body.error, "limit must be a number, not 'lots'", `${p} names the parameter and the value`);
      assert.equal(body.code, 'invalid', p);
      assert.doesNotMatch(body.error, /datatype mismatch|NaN/i, `${p} never passes SQLite's wording on`);
    }
  } finally { server.close(); }
});

test('a body limit that is not a number is the same 400 (Issue #1354)', async () => {
  const { w, t } = demo();
  const { server, base } = await serve(w);
  const post = (limit) => fetch(`${base}/api/tables/${t.id}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  try {
    const res = await post('lots');
    assert.equal(res.status, 400, 'the page the grid asks for is refused by name');
    const body = await res.json();
    assert.equal(body.error, "limit must be a number, not 'lots'");
    assert.equal(body.code, 'invalid');
    assert.equal(count(await (await post('2')).json()), 2, 'a numeric string is still a number');
  } finally { server.close(); }
});

test('a missing limit, an empty one and a number page exactly as they did (Issue #1354)', async () => {
  const { w, t } = demo();
  const { server, base } = await serve(w);
  try {
    assert.equal(count(await (await fetch(`${base}/api/audit`)).json()), 2, 'no limit keeps its default');
    assert.equal(count(await (await fetch(`${base}/api/audit?limit=`)).json()), 0, 'an empty limit reads as it always did');
    assert.equal(count(await (await fetch(`${base}/api/undo`)).json()), 3);
    assert.equal(count(await (await fetch(`${base}/api/tables/${t.id}/entities?limit=2`)).json()), 2, 'a number still pages');
    assert.equal((await (await fetch(`${base}/api/tables/${t.id}/entities?limit=2`)).json()).total, 3, 'and the total still counts every row');
  } finally { server.close(); }
});

test('a query-string offset that is not a number, or is negative, is a 400 naming offset (Issue #1374)', async () => {
  const { w, t } = demo();
  const { server, base } = await serve(w);
  try {
    for (const p of ['/api/audit?offset=nope', `/api/tables/${t.id}/entities?offset=nope`, `/api/tables/${t.id}/entities?offset=-1`]) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 400, `${p} answers 400`);
      const body = await res.json();
      assert.match(body.error, /^offset must be a whole number of rows, not '(nope|-1)'$/, p);
      assert.equal(body.code, 'invalid', p);
    }
    assert.equal(count(await (await fetch(`${base}/api/tables/${t.id}/entities`)).json()), 3, 'no offset keeps its default');
    const paged = await (await fetch(`${base}/api/tables/${t.id}/entities?offset=1`)).json();
    assert.equal(count(paged), 2, 'a number still skips');
    assert.equal(paged.total, 3, 'and the total still counts every row');
    assert.equal(count(await (await fetch(`${base}/api/audit?offset=1`)).json()), 1);
  } finally { server.close(); }
});
