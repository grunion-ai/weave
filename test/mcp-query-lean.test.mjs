import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, dispatchTool, TOOLS, QUERY_PAGE, QUERY_CAP } from '../src/mcp.js';
import { unwrapData, withServer } from './lib/fixtures.mjs';

const ROWS = 200;
const BUDGET = 64 * 1024;
const DOC = 'A full row carried this document four times over: fields, raw, doc and docs. '.repeat(60);

function tracker() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Release' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  w.addField('Dev/Issue', { name: 'Severity', type: 'select', config: { options: [{ name: 'High' }, { name: 'Low' }] } });
  w.addField('Dev/Issue', { name: 'Points', type: 'number' });
  w.addRelation('Dev/Issue', { name: 'Fixed in', targetDb: 'Dev/Release', cardinality: 'many-to-one' });
  for (let i = 0; i < ROWS; i++) w.createEntity('Dev/Release', { Name: `v0.4.${i}` });
  for (let i = 0; i < ROWS; i++) {
    const row = w.createEntity('Dev/Issue', { name: `Issue ${i}`, values: { Severity: i % 2 ? 'High' : 'Low', Points: i, 'Fixed in': `v0.4.${i}` }, doc: DOC });
    w.addComment(row.id, { text: `triaged ${i}` });
  }
  return w;
}

let rpcId = 0;
const wire = (w, name, args) => handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }).result;
const answer = (res) => {
  assert.ok(!res.isError, res.content[0].text);
  return unwrapData(res.content[0].text);
};
const refused = (res) => {
  assert.equal(res.isError, true, `refused: ${res.content[0].text}`);
  assert.equal(res.structuredContent.code, 'invalid');
  return res.content[0].text;
};

test('the default weave_query page on a 200-row table with long documents stays under 64 KB (Issue #1558)', () => {
  const w = tracker();
  const text = answer(wire(w, 'weave_query', { db: 'Issue' }));
  const page = JSON.parse(text);
  assert.equal(page.total, ROWS);
  assert.equal(page.items.length, QUERY_PAGE, 'the default page is still 200 rows');
  const bytes = Buffer.byteLength(text);
  const full = Buffer.byteLength(answer(wire(w, 'weave_query', { db: 'Issue', shape: 'full' })));
  assert.ok(bytes < BUDGET, `the default page is ${bytes} bytes, ${Math.round(bytes / ROWS)} a row, against a ${BUDGET}-byte budget`);
  assert.ok(full > bytes * 20, `shape full is ${full} bytes, the lean default ${bytes}`);
});

test('a lean row is id, publicId, name, revision and the value fields; documents, the Chip and Card views, raw and the chips map stay out (Issue #1558)', () => {
  const w = tracker();
  const page = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 3 });
  const full = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 3, shape: 'full' });
  const [row, whole] = [page.items[0], full.items[0]];
  assert.deepEqual(Object.keys(row).sort(), ['fields', 'id', 'name', 'publicId', 'revision']);
  assert.deepEqual(Object.keys(row.fields), ['Severity', 'Points', 'Fixed in'], 'the name, the document and the views are left out');
  assert.deepEqual(Object.keys(row.fields['Fixed in']).sort(), ['id', 'name', 'publicId'], 'a relation value is a chip');
  assert.equal(page.chips, undefined, 'related records are not summarised a second time');
  for (const k of ['id', 'publicId', 'name', 'revision']) assert.equal(row[k], whole[k], `${k} matches the full row`);
  for (const k of Object.keys(row.fields)) assert.deepEqual(row.fields[k], whole.fields[k], `${k} shows the value the full row shows`);
  assert.equal(row.revision, w.entityRevision(row.id), 'the revision is the one a conditional write checks');
});

test('shape full returns the envelope weave_query answered before the lean default (Issue #1558)', () => {
  const w = tracker();
  const full = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 5, shape: 'full' });
  assert.deepEqual(full, w.query('Issue', { limit: 5, relations: 'chip' }));
  for (const k of ['raw', 'doc', 'docs', 'comments', 'activity', 'files', 'url']) assert.ok(k in full.items[0], `full keeps ${k}`);
  assert.equal(full.items[0].fields.Description, DOC);
  assert.ok(full.chips, 'full keeps the chips map');
});

test('shape row is still the Issue #1270 list row, and select the flat projection (Issue #1558)', () => {
  const w = tracker();
  assert.deepEqual(dispatchTool(w, 'weave_query', { db: 'Issue', limit: 2, shape: 'row' }), w.query('Issue', { limit: 2, relations: 'chip', shape: 'row' }));
  assert.deepEqual(dispatchTool(w, 'weave_query', { db: 'Issue', limit: 2, select: ['Points'] }), w.query('Issue', { limit: 2, select: ['Points'] }));
  assert.match(refused(wire(w, 'weave_query', { db: 'Issue', shape: 'tiny' })), /shape must be 'lean', 'row' or 'full'/);
});

test('fields named on a lean read come back as named: a document in full, a system column under its envelope key (Issue #1558)', () => {
  const w = tracker();
  const [row] = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 1, fields: ['Name', 'Description', 'Created At'] }).items;
  const [whole] = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 1, shape: 'full' }).items;
  assert.deepEqual(Object.keys(row.fields), ['Name', 'Description']);
  assert.equal(row.fields.Description, DOC);
  assert.equal(row.createdAt, whole.createdAt);
  assert.equal('updatedAt' in row, false, 'a system column left unnamed stays out');
});

test('a trashed lean row says so and a live one spends no bytes on it (Issue #1558)', () => {
  const w = tracker();
  const victim = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 1 }).items[0];
  w.deleteEntity(victim.id);
  const page = dispatchTool(w, 'weave_query', { db: 'Issue', limit: 2, includeDeleted: true });
  assert.ok(page.items.find((r) => r.id === victim.id).deletedAt);
  assert.equal('deletedAt' in page.items.find((r) => r.id !== victim.id), false);
});

test('on MCP a limit above 2,000 or of -1 refuses and names the cursor read (Issue #1558)', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Case' });
  for (let i = 0; i < QUERY_CAP + 1; i++) w.createEntity('Dev/Case', { Name: `case ${i}` });
  assert.equal(QUERY_CAP, 2000);
  for (const limit of [QUERY_CAP + 1, -1, -5, 2.5, 'all', true]) {
    const text = refused(wire(w, 'weave_query', { db: 'Case', limit }));
    assert.match(text, /at most 2000 rows/, `limit ${JSON.stringify(limit)}: ${text}`);
    assert.match(text, /nextOffset/, 'the refusal names the cursor read');
    assert.match(refused(wire(w, 'weave_call', { name: 'weave_query', args: { db: 'Case', limit } })), /nextOffset/, 'weave_call holds the same cap');
  }
  const most = JSON.parse(answer(wire(w, 'weave_query', { db: 'Case', limit: QUERY_CAP, select: ['Name'] })));
  assert.equal(most.items.length, QUERY_CAP, 'a 2,000-row page is taken');
  assert.equal(most.nextOffset, QUERY_CAP, 'and points at the row it left out');
  const rest = JSON.parse(answer(wire(w, 'weave_query', { db: 'Case', limit: QUERY_CAP, offset: most.nextOffset, select: ['Name'] })));
  assert.deepEqual(rest.items.map((r) => r.name), [`case ${QUERY_CAP}`]);
  assert.equal(rest.nextOffset, undefined);
  assert.equal(JSON.parse(answer(wire(w, 'weave_query', { db: 'Case', limit: 0, countAll: true }))).all, QUERY_CAP + 1, 'limit 0 still counts');
});

test('a numeric string limit or offset pages as a number and never runs past the page (Issue #1558)', () => {
  const w = tracker();
  const names = (args) => dispatchTool(w, 'weave_query', { db: 'Issue', select: ['Points'], ...args }).items.map((r) => r.name);
  assert.deepEqual(names({ offset: '1', limit: 3 }), ['Issue 1', 'Issue 2', 'Issue 3']);
  assert.deepEqual(names({ offset: 1, limit: '3' }), ['Issue 1', 'Issue 2', 'Issue 3']);
  assert.match(refused(wire(w, 'weave_query', { db: 'Issue', offset: -1 })), /offset must be a whole number/);
  assert.match(refused(wire(w, 'weave_query', { db: 'Issue', limit: '-1' })), /nextOffset/);
});

test('REST keeps the full envelope and its -1 whole read in this item (Issue #1558)', async () => {
  const w = tracker();
  await withServer(w, async ({ base }) => {
    const read = async (body) => (await fetch(`${base}/api/tables/Dev%2FIssue/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const whole = await read({ limit: -1 });
    assert.equal(whole.items.length, ROWS, 'POST /api/tables/:db/query still takes -1');
    assert.ok('raw' in whole.items[0] && 'url' in whole.items[0], 'and answers the full envelope');
  });
});

test('weave_query says what a lean row holds and how far one page reads (Issue #1558)', () => {
  const tool = TOOLS.find((t) => t.name === 'weave_query');
  const { shape, relations } = tool.inputSchema.properties;
  assert.deepEqual(shape.enum, ['lean', 'row', 'full']);
  assert.match(shape.description, /^Default lean/);
  assert.match(tool.description, /at most 2000/);
  assert.match(tool.description, /nextOffset/);
  assert.doesNotMatch(tool.description, /limit: -1/, 'the whole-table read is no longer advertised');
  assert.match(relations.description, /row and full/, 'the chips map is named for the shapes that carry it');
});
