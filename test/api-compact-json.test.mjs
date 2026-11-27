import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function withServer(fn) {
  const weave = new Weave();
  weave.createSpace({ name: 'Sales' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  for (let i = 0; i < 5; i++) weave.createEntity(deals.id, { Name: `Deal ${i}` });
  const { server, port } = await startServer(weave, { port: 0 });
  try { await fn(`http://127.0.0.1:${port}`, deals); } finally { server.close(); }
}

test('API bodies are compact JSON unless the caller asks for ?pretty=1 (Issue #1643)', async () => {
  await withServer(async (base, deals) => {
    for (const path of ['/api/schema', `/api/tables/${deals.id}/entities`]) {
      const plain = await fetch(base + path);
      assert.equal(plain.status, 200, path);
      const text = await plain.text();
      assert.ok(!text.includes('\n'), `${path} still pretty-prints: ${text.slice(0, 40)}`);
      const pretty = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}pretty=1`);
      assert.equal(pretty.status, 200, `${path}?pretty=1`);
      const shown = await pretty.text();
      assert.match(shown, /^[{[]\n /, `${path}?pretty=1 is indented for a person`);
      assert.deepEqual(JSON.parse(shown), JSON.parse(text));
    }
  });
});
