import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

const ENVELOPE_ONLY = ['revision', 'url', 'db', 'dbId', 'createdAt', 'updatedAt', 'createdBy', 'modifiedBy', 'docs', 'doc', 'docField'];

function buildWorkspace(w = new Weave(), rows = 4) {
  w.createSpace({ name: 'Quality' });
  const suites = w.createTable({ space: 'Quality', name: 'Suite' });
  const cases = w.createTable({ space: 'Quality', name: 'Case' });
  w.addField(cases, { name: 'Line', type: 'number' });
  w.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  const grid = w.createEntity(suites, { name: 'grid.test.mjs' });
  for (let i = 0; i < rows; i++) {
    w.createEntity(cases, { name: `case ${i}`, values: { Line: i, Suite: grid.id }, doc: `desc ${i}` });
  }
  return { w, suites, cases, grid };
}

const LEAN_OPTS = { sort: ['Line'], fields: ['Name', 'Chip'], relations: 'chip' };

test('shape row: a list row is id, publicId, name, fields and raw, nothing else (Issue #1270)', () => {
  const { w, cases } = buildWorkspace();
  const full = w.query(cases, LEAN_OPTS);
  const lean = w.query(cases, { ...LEAN_OPTS, shape: 'row' });
  assert.equal(lean.total, full.total, 'the same rows are counted');
  const [a, b] = [full.items[0], lean.items[0]];
  assert.deepEqual(Object.keys(b).sort(), ['fields', 'id', 'name', 'publicId', 'raw'], 'the lean row carries nothing else');
  for (const k of ['id', 'publicId', 'name']) assert.equal(b[k], a[k], `${k} is kept`);
  assert.deepEqual(b.fields, a.fields, 'the drawn fields are untouched');
  for (const k of ENVELOPE_ONLY) assert.equal(k in b, false, `${k} is left out of a list row`);
});

test('shape row: raw stays where it differs from the display value and goes where it is identical (Issue #1270)', () => {
  const { w, cases } = buildWorkspace();
  const lean = w.query(cases, { ...LEAN_OPTS, shape: 'row' }).items[0];
  const full = w.query(cases, LEAN_OPTS).items[0];
  assert.deepEqual(lean.raw.Chip, full.raw.Chip, 'the chip view the renderer reads survives');
  assert.equal('Name' in lean.raw, false, 'a name whose raw equals its display value sends one copy');
  assert.equal(lean.fields.Name, full.raw.Name, 'and the one copy carries the same value');
});

test('shape row: a trashed row keeps its tombstone marker (Issue #1270)', () => {
  const { w, cases } = buildWorkspace();
  const victim = w.query(cases, { sort: ['Line'] }).items[0];
  w.deleteEntity(victim.id);
  const lean = w.query(cases, { sort: ['Line'], includeDeleted: true, fields: ['Name'], shape: 'row' });
  assert.ok(lean.items.find((i) => i.id === victim.id).deletedAt, 'the trashed row says so');
  assert.equal('deletedAt' in lean.items.find((i) => i.id !== victim.id), false, 'a live row spends no bytes on it');
});

test('shape row: the answer stays under the 62% the Issue budgets for a lean list (Issue #1270)', () => {
  const { w, cases } = buildWorkspace(new Weave(), 400);
  const fullBytes = Buffer.byteLength(JSON.stringify(w.query(cases, LEAN_OPTS)));
  const leanBytes = Buffer.byteLength(JSON.stringify(w.query(cases, { ...LEAN_OPTS, shape: 'row' })));
  assert.ok(leanBytes < fullBytes * 0.62, `lean ${leanBytes} of full ${fullBytes}`);
});

test('shape: full is the default and anything else is refused (Issue #1270)', () => {
  const { w, cases } = buildWorkspace();
  assert.deepEqual(w.query(cases, { sort: ['Line'] }), w.query(cases, { sort: ['Line'], shape: 'full' }));
  assert.throws(() => w.query(cases, { shape: 'lean' }), /shape must be 'full' or 'row'/);
});

test('shape row: a select projection is already lean, so shape leaves it alone (Issue #1270)', () => {
  const { w, cases } = buildWorkspace();
  const sel = { sort: ['Line'], select: ['Line'] };
  assert.deepEqual(w.query(cases, sel), w.query(cases, { ...sel, shape: 'row' }));
  assert.deepEqual(Object.keys(w.query(cases, sel).items[0]).sort(), ['Line', 'id', 'name', 'publicId']);
});

test('shape row: REST, MCP and CLI all answer the lean row (Issue #1270)', async () => {
  const { w, cases } = buildWorkspace();
  const props = TOOLS.find((t) => t.name === 'weave_query').inputSchema.properties;
  assert.match(props.shape.description, /row/, 'MCP query advertises shape');
  const m = dispatchTool(w, 'weave_query', { db: 'Case', fields: ['Name', 'Chip'], relations: 'chip', shape: 'row', limit: 1 });
  assert.equal('url' in m.items[0], false, 'the MCP weave_query drops the envelope');

  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/Case/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: ['Name', 'Chip'], relations: 'chip', shape: 'row', limit: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal('url' in body.items[0], false, 'the route passes shape through to the engine');
    assert.ok(body.items[0].fields.Name, 'the drawn field still arrives');
  } finally {
    server.close();
  }

  const dir = tempDir('weave-query-shape-');
  try {
    const data = join(dir, 'ws.db');
    const d = new Weave({ path: data });
    buildWorkspace(d);
    d.close?.();
    const out = JSON.parse(execFileSync('node', [BIN, 'query', 'Case', '--fields', 'Name,Chip', '--relations', 'chip', '--shape', 'row', '--limit', '1', '--data', data], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.equal('url' in out.items[0], false, 'the CLI --shape row drops the envelope');
    assert.ok(out.items[0].fields.Name, 'and still draws the field');
    assert.match(execFileSync('node', [BIN, '--help'], { encoding: 'utf8' }), /--shape row/, 'the CLI usage names it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
