import test from 'node:test';
import assert from 'node:assert/strict';

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

test('a mermaid line break in a label becomes a real newline (Issue #471)', () => {
  const g = parse(`flowchart TD
  A[run in a frame\\n+ toggle for source] --> B["one<br>two"]
  B --> C[three<br/>four]
  C --> D[five<br />six]
  D --> E[seven<BR>eight]
  E --> F[nine<br >ten]
  F -->|wait<br>then go| A`);
  const label = (id) => g.nodes.find((n) => n.id === id).label;
  assert.equal(label('A'), 'run in a frame\n+ toggle for source');
  assert.equal(label('B'), 'one\ntwo');
  assert.equal(label('C'), 'three\nfour');
  assert.equal(label('D'), 'five\nsix');
  assert.equal(label('E'), 'seven\neight');
  assert.equal(label('F'), 'nine\nten');
  assert.equal(g.edges.find((e) => e.to === 'A').label, 'wait\nthen go');
});

test('a tag that is not a break is left alone (Issue #471)', () => {
  const g = parse('flowchart TD\n  A[a <brief> note] --> B[plain]');
  assert.equal(g.nodes.find((n) => n.id === 'A').label, 'a <brief> note');
  assert.equal(g.nodes.find((n) => n.id === 'B').label, 'plain');
});
