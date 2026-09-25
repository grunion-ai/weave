/* A table query answers what its reader draws (Issue #272).

   `POST /api/tables/Case/query {}` answered 10,224,700 bytes for 2,060 rows:
   every field of every row, each row's comments, activity and files, and for
   a relation the full summary of the far row (its chip, whose segments can
   hold a whole inverse relation's names) once per row that points at it,
   so the same forty suites were serialised two thousand times. The grid
   draws its visible columns and a chip per related row.

   Two opt-ins, both off by default so every other caller keeps its shape:
   - `fields: [...]` keeps the entity shape but cuts `fields`, `raw` and
     `docs` to the named fields (and a system column), and leaves out the
     comments, the activity and the files;
   - `relations: 'chip'` answers a relation value as `{ id, publicId, name }`
     and sends each far row's summary once, in `chips`, keyed by id. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

function buildWorkspace(w = new Weave()) {
  w.createSpace({ name: 'Quality' });
  const suites = w.createTable({ space: 'Quality', name: 'Suite' });
  const cases = w.createTable({ space: 'Quality', name: 'Case' });
  w.addField(cases, { name: 'Line', type: 'number' });
  w.addField(cases, {
    name: 'Status', type: 'workflow', config: { states: [
      { name: 'Passing', category: 'done', default: true }, { name: 'Failing', category: 'in-progress' }] },
  });
  w.addField(cases, { name: 'Notes', type: 'document' });
  w.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  const grid = w.createEntity(suites, { name: 'grid.test.mjs', doc: 'A long description. '.repeat(50) });
  const eng = w.createEntity(suites, { name: 'engine.test.mjs' });
  const made = [];
  for (let i = 0; i < 6; i++) {
    made.push(w.createEntity(cases, { name: `case ${i}`, values: { Line: i, Status: i % 2 ? 'Failing' : 'Passing', Suite: (i < 4 ? grid : eng).id }, doc: `desc ${i}` }));
  }
  w.addComment(made[0].id, { text: 'a comment' });
  return { w, suites, cases, grid, eng, made };
}

test('fields: the entity shape, cut to the named fields', () => {
  const { w, cases } = buildWorkspace();
  const full = w.query(cases, { sort: ['Line'] });
  const cut = w.query(cases, { sort: ['Line'], fields: ['Name', 'Line'] });
  assert.equal(cut.total, full.total);
  const [a, b] = [full.items[0], cut.items[0]];
  assert.deepEqual(Object.keys(b.fields), ['Name', 'Line'], 'only the named fields, in the table\'s order');
  assert.deepEqual(Object.keys(b.raw), ['Name', 'Line']);
  assert.equal(b.fields.Line, a.fields.Line);
  assert.deepEqual(b.raw.Line, a.raw.Line);
  // The row's identity and its stamps ride along: the grid's row chrome and
  // its system columns read them.
  for (const k of ['id', 'publicId', 'db', 'dbId', 'name', 'createdAt', 'updatedAt', 'createdBy', 'modifiedBy', 'deletedAt', 'url']) {
    assert.deepEqual(b[k], a[k], `${k} is kept`);
  }
  // The heavy parts are left out unless asked for.
  for (const k of ['comments', 'activity', 'files', 'doc', 'docField']) assert.equal(k in b, false, `${k} is left out`);
  assert.deepEqual(b.docs, {}, 'no document was named, so none is sent');
  assert.ok(a.comments.length && a.activity.length, 'the full read still carries them');
});

test('fields: a named document sends its text; Activity brings the history', () => {
  const { w, cases } = buildWorkspace();
  const r = w.query(cases, { sort: ['Line'], fields: ['Description', 'Activity'] }).items[0];
  assert.deepEqual(r.docs, { Description: 'desc 0' }, 'the named document only');
  assert.equal(r.doc, 'desc 0', 'the default document comes with it, as readEntity names it');
  assert.equal(r.docField, 'Description');
  assert.ok(Array.isArray(r.activity) && r.activity.length, 'the Activity column counts the history');
  assert.equal('Notes' in r.docs, false);
  assert.deepEqual(Object.keys(r.fields), ['Description']);
});

test('fields: a name that is not a field or a system column is refused', () => {
  const { w, cases } = buildWorkspace();
  assert.throws(() => w.query(cases, { fields: ['Nope'] }), /Field 'Nope' not found/);
  assert.throws(() => w.query(cases, { fields: 'Name' }), /fields/);
  assert.throws(() => w.query(cases, { fields: ['Name'], select: ['Line'] }), /select or fields/);
  // A system column's own name is not an error: its value rides the row.
  assert.equal(w.query(cases, { fields: ['Created At', 'Modified By'] }).items.length, 6);
});

test('relations: chip answers a reference per row and each far row once', () => {
  const { w, cases, grid, eng } = buildWorkspace();
  const full = w.query(cases, { sort: ['Line'] });
  const chip = w.query(cases, { sort: ['Line'], relations: 'chip' });
  const ref = chip.items[0].fields.Suite;
  assert.deepEqual(ref, { id: grid.id, publicId: grid.publicId, name: 'grid.test.mjs' }, 'the row carries the reference');
  assert.deepEqual(chip.items[0].raw.Suite, full.items[0].raw.Suite, 'raw is the ids, as ever');
  assert.deepEqual(Object.keys(chip.chips).sort(), [grid.id, eng.id].sort(), 'each far row once');
  assert.deepEqual(chip.chips[grid.id], full.items[0].fields.Suite, 'the chip is the summary a full read embeds');
  // The inverse side is a to-many relation: an array of references.
  const suites = w.query('Suite', { relations: 'chip', sort: ['Name'] });
  assert.deepEqual(suites.items.find((s) => s.id === grid.id).fields.Cases.map((c) => c.name), ['case 0', 'case 1', 'case 2', 'case 3']);
  assert.equal(Object.keys(suites.chips).length, 6);
  assert.throws(() => w.query(cases, { relations: 'bogus' }), /relations/);
});

test('the default query is unchanged: full rows, full summaries, no chips', () => {
  const { w, cases, grid } = buildWorkspace();
  const q = w.query(cases, { sort: ['Line'] });
  assert.deepEqual(Object.keys(q), ['total', 'items']);
  assert.equal(q.items[0].fields.Suite.id, grid.id);
  assert.ok(q.items[0].fields.Suite.chip, 'a full summary carries the chip view');
  assert.deepEqual(q.items[0], w.readEntity(q.items[0].id), 'a row is what readEntity reads');
  assert.deepEqual(w.query(cases, { relations: 'full' }).items[0], q.items[0], "'full' is the default, spelled out");
});

test('fields and relations together: the grid page', () => {
  const { w, cases, grid } = buildWorkspace();
  const q = w.query(cases, { sort: ['Line'], limit: 2, fields: ['Name', 'Suite'], relations: 'chip', trashCount: true });
  assert.deepEqual(Object.keys(q).sort(), ['chips', 'items', 'total', 'trashCount']);
  assert.equal(q.total, 6);
  assert.deepEqual(Object.keys(q.chips), [grid.id], 'only the far rows this page points at');
  assert.deepEqual(q.items[1].fields, { Name: 'case 1', Suite: { id: grid.id, publicId: grid.publicId, name: 'grid.test.mjs' } });
  // A narrower answer, measurably.
  const full = JSON.stringify(w.query(cases, { sort: ['Line'], limit: 2 })).length;
  assert.ok(JSON.stringify(q).length < full / 2, `the cut page is under half the full one (${JSON.stringify(q).length} of ${full})`);
});

test('REST, MCP and CLI carry fields and relations', async () => {
  const { w, grid } = buildWorkspace();
  const props = TOOLS.find((t) => t.name === 'weave_query').inputSchema.properties;
  assert.ok(props.fields && props.relations, 'MCP query must advertise fields and relations');
  const m = dispatchTool(w, 'weave_query', { db: 'Case', fields: ['Suite'], relations: 'chip', limit: 1 });
  assert.deepEqual(Object.keys(m.items[0].fields), ['Suite']);
  assert.ok(m.chips[grid.id]);

  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/Case/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: ['Name', 'Suite'], relations: 'chip', limit: 1 }),
    });
    const body = await res.json();
    assert.deepEqual(Object.keys(body.items[0].fields), ['Name', 'Suite']);
    assert.equal(body.items[0].fields.Suite.name, 'grid.test.mjs');
    assert.ok(body.chips[grid.id].chip, 'the chip rides once, in chips');
  } finally {
    server.close();
  }

  const dir = mkdtempSync(join(tmpdir(), 'weave-query-fields-'));
  try {
    const data = join(dir, 'ws.db');
    const d = new Weave({ path: data });
    buildWorkspace(d);
    d.close?.();
    const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const out = JSON.parse(execFileSync('node', [BIN, 'query', 'Case', '--fields', 'Name,Suite', '--relations', 'chip', '--limit', '1', '--data', data], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.deepEqual(Object.keys(out.items[0].fields), ['Name', 'Suite']);
    assert.equal(Object.keys(out.chips).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
