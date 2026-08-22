import test from 'node:test';
import assert from 'node:assert/strict';

/* The whiteboard's parser (Feature #46): weave's own mermaid dialect in,
   nodes and edges out; anything else ignored, never fatal. */
await import('../public/graph-parse.js');
const parse = globalThis.parseMermaidGraph;

test('the relation map dialect round-trips', () => {
  const g = parse(`graph LR
  subgraph "Dev"
    T1["Task"]
    T2["Project"]
  end
  T1 -- "Project" --> T2`);
  assert.equal(g.direction, 'LR');
  assert.deepEqual(g.nodes.map((n) => n.label).sort(), ['Project', 'Task']);
  assert.deepEqual(g.edges, [{ from: 'T1', to: 'T2', label: 'Project' }]);
});

test('shapes and pipe labels', () => {
  const g = parse(`flowchart TD
  A[Start] --> B{Decide}
  B -->|yes| C((Done))
  B -->|no| A`);
  assert.equal(g.nodes.find((n) => n.id === 'B').shape, 'diamond');
  assert.equal(g.nodes.find((n) => n.id === 'C').shape, 'circle');
  assert.equal(g.edges.find((e) => e.to === 'C').label, 'yes');
  assert.equal(g.edges.length, 3);
});

test('garbage and non-graphs come back empty, never throw', () => {
  assert.deepEqual(parse('sequenceDiagram\n  A->>B: hi').edges, []);
  assert.deepEqual(parse('').nodes, []);
  assert.deepEqual(parse(null).nodes, []);
});
