import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

let base, server;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, type, headers: res.headers };
}

test.before(async () => {
  const weave = new Weave();
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('health and schema bootstrap', async () => {
  const health = await api('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  assert.equal((await api('POST', '/api/spaces', { name: 'Product' })).status, 201);
  assert.equal((await api('POST', '/api/tables', { space: 'Product', name: 'Project' })).status, 201);
  assert.equal((await api('POST', '/api/tables', { space: 'Product', name: 'Task' })).status, 201);

  await api('POST', '/api/tables/Project/fields', { name: 'Budget', type: 'number' });
  await api('POST', '/api/tables/Task/fields', { name: 'Estimate', type: 'number' });
  await api('POST', '/api/tables/Task/fields', {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  const rel = await api('POST', '/api/tables/Task/relations', {
    name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks',
  });
  assert.equal(rel.status, 201);

  await api('POST', '/api/tables/Project/fields', {
    name: 'Total Estimate', type: 'rollup',
    config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' },
  });
  await api('POST', '/api/tables/Task/fields', {
    name: 'Project Budget', type: 'lookup',
    config: { relationField: 'Project', targetField: 'Budget' },
  });

  const schema = await api('GET', '/api/schema');
  assert.equal(schema.data[0].space, 'Product');
  assert.equal(schema.data[0].tables.length, 2);
});

let projectId, taskId;

test('entity lifecycle over HTTP', async () => {
  const p = await api('POST', '/api/tables/Project/entities', { name: 'Apollo', values: { Budget: 5000 } });
  assert.equal(p.status, 201);
  projectId = p.data.id;

  const t = await api('POST', '/api/tables/Task/entities', { name: 'Design', values: { Estimate: 8, Project: 'Apollo' } });
  assert.equal(t.status, 201);
  taskId = t.data.id;
  assert.equal(t.data.fields.Project.name, 'Apollo');
  assert.equal(t.data.fields['Project Budget'], 5000);
  assert.equal(t.data.fields.State, 'Open');

  const proj = await api('GET', `/api/entities/${projectId}`);
  assert.equal(proj.data.fields['Total Estimate'], 8);
  assert.deepEqual(proj.data.fields.Tasks.map((s) => s.name), ['Design']);

  const upd = await api('PATCH', `/api/entities/${taskId}`, { values: { Estimate: 13 } });
  assert.equal(upd.data.fields.Estimate, 13);
  assert.equal((await api('GET', `/api/entities/${projectId}`)).data.fields['Total Estimate'], 13);

  const st = await api('POST', `/api/entities/${taskId}/state`, { field: 'State', state: 'Done' });
  assert.equal(st.data.fields.State, 'Done');
});

test('query endpoint', async () => {
  await api('POST', '/api/tables/Task/entities', { name: 'Build', values: { Estimate: 21, Project: 'Apollo' } });
  const q = await api('POST', '/api/tables/Task/query', {
    where: [['Project.Name', '=', 'Apollo'], ['Estimate', '>', 15]],
    select: ['Estimate', 'State'],
  });
  assert.equal(q.data.total, 1);
  assert.equal(q.data.items[0].name, 'Build');
  assert.equal(q.data.items[0].Estimate, 21);
});

test('document endpoints serve MD, HTML, PDF natively', async () => {
  await api('PUT', `/api/entities/${taskId}/doc`, {
    doc: '# Design notes\n\nRelated: [[Task#2]]\n\n- [x] wireframes\n- [ ] mockups',
  });
  await api('POST', `/api/entities/${taskId}/doc`, { doc: 'Appended line.' });

  const md = await fetch(`${base}/e/${taskId}/doc.md`);
  assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');
  const mdText = await md.text();
  assert.match(mdText, /# Design notes/);
  assert.match(mdText, /Appended line\./);

  const html = await fetch(`${base}/e/${taskId}/doc.html`);
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  const htmlText = await html.text();
  assert.match(htmlText, /<h1>Design notes<\/h1>/);
  assert.match(htmlText, /class="mention"/); // [[Task#2]] resolved to a link
  assert.match(htmlText, /Task#2 — Build/);

  const pdf = await fetch(`${base}/e/${taskId}/doc.pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.ok(buf.toString('latin1').startsWith('%PDF-1.4'));
  assert.match(buf.toString('latin1'), /Design notes/);
});

test('comments, search, csv, automations over HTTP', async () => {
  const c = await api('POST', `/api/entities/${taskId}/comments`, { author: 'kyle', text: 'ship it' });
  assert.equal(c.status, 201);

  const s = await api('GET', '/api/search?q=design');
  assert.ok(s.data.some((r) => r.name === 'Design'));

  const csv = await fetch(`${base}/api/tables/Task/export.csv`);
  assert.match(await csv.text(), /Design/);

  const auto = await api('POST', '/api/automations', {
    db: 'Task', name: 'log done',
    trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
    actions: [{ type: 'add-comment', text: 'auto: {{Name}} done' }],
  });
  assert.equal(auto.status, 201);
  const list = await api('GET', '/api/automations?db=Task');
  assert.equal(list.data.length, 1);
});

test('error semantics', async () => {
  assert.equal((await api('GET', '/api/entities/nope')).status, 404);
  assert.equal((await api('POST', '/api/spaces', { name: 'Product' })).status, 409);
  assert.equal((await api('POST', '/api/tables/Task/fields', { name: 'Bad', type: 'nope' })).status, 400);
  assert.equal((await api('GET', '/api/nothing')).status, 404);
});

test('export/import roundtrip preserves workspace', async () => {
  const dump = await api('GET', '/api/export');
  assert.equal(dump.status, 200);
  const imp = await api('POST', '/api/import', dump.data);
  assert.equal(imp.status, 200);
  const q = await api('POST', '/api/tables/Task/query', {});
  assert.ok(q.data.total >= 2);
});
