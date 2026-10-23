import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const LINE = {
  head: /^graph LR$/,
  space: /^ {2}subgraph "([^"]+)"$/,
  node: /^ {4}(T[0-9a-f]{8})\["([^"]+)"\]$/,
  end: /^ {2}end$/,
  edge: /^ {2}(T[0-9a-f]{8}) -- "([^"]+)" --> (T[0-9a-f]{8})$/,
};

function parseFlowchart(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  assert.match(lines[0], LINE.head, 'a Mermaid flowchart, left to right');
  const spaces = {};
  const nodes = {};
  const edges = [];
  let open = null;
  for (const line of lines.slice(1)) {
    let m;
    if ((m = line.match(LINE.space))) { assert.equal(open, null, 'subgraphs do not nest'); open = m[1]; spaces[open] = []; }
    else if ((m = line.match(LINE.node))) { assert.ok(open, `${line} sits inside a space`); nodes[m[1]] = m[2]; spaces[open].push(m[2]); }
    else if (LINE.end.test(line)) { assert.ok(open, 'every end closes a subgraph'); open = null; }
    else if ((m = line.match(LINE.edge))) edges.push({ from: nodes[m[1]], label: m[2], to: nodes[m[3]] });
    else assert.fail(`a line Mermaid's flowchart grammar does not take: ${JSON.stringify(line)}`);
  }
  assert.equal(open, null, 'every subgraph is closed');
  for (const e of edges) assert.ok(e.from && e.to, 'every edge joins two declared nodes');
  return { spaces, edges };
}

test('GET /api/relation-map.mmd answers a Mermaid flowchart: one subgraph per space, one edge per relation', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Sales', name: 'Account' });
  w.createTable({ space: 'Sales', name: 'Deal' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addRelation('Sales/Deal', { name: 'Account', targetDb: 'Sales/Account', cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addRelation('Ops/Task', { name: 'Deal', targetDb: 'Sales/Deal', cardinality: 'many-to-many', inverseName: 'Tasks' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/relation-map.mmd`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    const { spaces, edges } = parseFlowchart(await res.text());
    assert.deepEqual(spaces, { Sales: ['Account', 'Deal'], Ops: ['Task'] });
    assert.deepEqual(edges, [
      { from: 'Account', label: 'Deals', to: 'Deal' },
      { from: 'Deal', label: 'Tasks', to: 'Task' },
    ]);

    const wrong = await fetch(`${base}/api/relation-map.mmd`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(wrong.status, 404, 'the map is read-only');
    assert.match((await wrong.json()).error, /No route: POST \/api\/relation-map\.mmd/);
  } finally {
    server.close();
  }
});

test('an empty workspace maps to a bare flowchart header', async () => {
  const w = new Weave();
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/relation-map.mmd`);
    assert.equal(res.status, 200);
    assert.deepEqual(parseFlowchart(await res.text()), { spaces: {}, edges: [] });
  } finally {
    server.close();
  }
});
