import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function withServer(fn) {
  const weave = new Weave();
  weave.createSpace({ name: 'Library' });
  weave.createTable({ space: 'Library', name: 'Saves' });
  const saved = weave.addField('Library/Saves', { name: 'Saved', type: 'date', config: { time: true, default: 'now()' } });
  weave.now = () => new Date('2026-11-08T21:41:00Z');
  const { server, port } = await startServer(weave, { port: 0 });
  try { await fn(port, { weave, saved }); } finally { server.close(); }
}

const post = (port, headers) => fetch(`http://127.0.0.1:${port}/api/tables/Saves/entities`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'A share' }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a POST carrying X-Weave-Zone stamps a floating now() default in that zone (Issue #1480)', async () => {
  await withServer(async (port, { weave, saved }) => {
    const made = await post(port, { 'X-Weave-Zone': 'America/New_York' });
    assert.equal(made.status, 201);
    assert.equal(weave.getEntity(made.body.id).values[saved.id], '2026-11-08T16:41');
  });
});

test('a POST with no zone header keeps the UTC wall clock (Issue #1480)', async () => {
  await withServer(async (port, { weave, saved }) => {
    const made = await post(port, {});
    assert.equal(made.status, 201);
    assert.equal(weave.getEntity(made.body.id).values[saved.id], '2026-11-08T21:41');
  });
});
