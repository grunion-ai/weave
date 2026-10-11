import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { createForm, getForm, listForms, submitForm, ensureBugForm, BUG_FORM_NAME, renderFormPage } from '../src/forms.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const CLIENT = { url: 'http://localhost/f/x', route: '/f/x', userAgent: 'test', filedAt: '2026-10-09T12:00:00Z' };

function feedbackWorkspace() {
  const w = new Weave();
  w.state.meta.name = 'acme';
  w.createSpace({ name: 'Support' });
  const t = w.createTable({ space: 'Support', name: 'Feedback' });
  w.addField(t.id, { name: 'Mood', type: 'select', config: { options: ['Happy', 'Sad'] } });
  w.addField(t.id, { name: 'Reporter', type: 'text' });
  w.addField(t.id, { name: 'Filed At', type: 'text' });
  w.addField(t.id, { name: 'Build', type: 'text' });
  w.addField(t.id, { name: 'Notes', type: 'document' });
  w.createSpace({ name: 'Other' });
  w.createTable({ space: 'Other', name: 'Secret' });
  w.createEntity('Other/Secret', { name: 'keep out' });
  const form = createForm(w, {
    name: 'Tell us',
    table: 'Support/Feedback',
    fields: [{ field: 'Name', label: 'Headline' }, { field: 'Mood', label: 'How do you feel', default: 'Happy' }, { field: 'Notes', label: 'Anything else' }],
    hidden: { Reporter: '$actor', 'Filed At': '$now', Build: '$version' },
  });
  return { w, form, table: w.getTable('Support/Feedback') };
}

const rowCounts = (w) => Object.fromEntries(w.listTables().map((t) => [w.qualifiedName(t), w.listEntities(t.id).length]));

test('every workspace carries Workspace/Forms beside Spaces, Tables and Fields', () => {
  const w = new Weave();
  const t = w.getTable('Workspace/Forms');
  assert.equal(t.system, 'forms');
  const names = Object.values(t.fields).map((f) => f.name);
  for (const n of ['Name', 'Description', 'Table', 'Fields', 'Hidden', 'Enabled', 'Floor', 'Kind']) assert.ok(names.includes(n), `Workspace/Forms has ${n}`);
  assert.equal(w.findField(t, 'Table').type, 'relation');
  assert.ok(Object.values(t.fields).every((f) => f.system), 'every column of the registry is a system column');
});

test('a form is a row in Workspace/Forms naming its table, its fields in order, and what the server fills', () => {
  const { w, form } = feedbackWorkspace();
  const row = w.getEntity(form.id);
  assert.equal(w.state.tables[row.dbId].system, 'forms');
  const def = getForm(w, form.id);
  assert.equal(def.name, 'Tell us');
  assert.equal(def.table, 'Support/Feedback');
  assert.deepEqual(def.fields.map((f) => f.label), ['Headline', 'How do you feel', 'Anything else']);
  assert.deepEqual(def.hidden, ['Reporter', 'Filed At', 'Build']);
  assert.equal(def.enabled, true);
  assert.equal(def.floor, 'Observer');
  assert.equal(getForm(w, 'Tell us').id, form.id, 'a form is found by its name too');
  assert.deepEqual(listForms(w).map((f) => f.name), ['Tell us']);
});

test('submitting creates exactly one row and nothing else, and the submitter is its author', () => {
  const { w, form, table } = feedbackWorkspace();
  const before = rowCounts(w);
  const audit = w.listAudit({ limit: 500 }).length;
  const made = submitForm(w, form.id, { values: { Headline: 'Love it', 'How do you feel': 'Sad', Notes: 'more please' } }, { actor: 'dana', server: { version: '9.9.9' } });
  const after = rowCounts(w);
  for (const [k, n] of Object.entries(before)) assert.equal(after[k], k === 'Support/Feedback' ? n + 1 : n, `${k} row count`);
  assert.equal(made.table, 'Support/Feedback');
  const e = w.readEntity(made.id);
  assert.equal(e.name, 'Love it');
  assert.equal(e.fields.Mood, 'Sad');
  assert.equal(e.docs.Notes, 'more please');
  assert.equal(e.createdBy, 'dana');
  assert.equal(e.fields.Reporter, 'dana', 'the server fills the reporter');
  assert.equal(e.fields.Build, '9.9.9', 'and the version');
  assert.match(e.fields['Filed At'], /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(w.listAudit({ limit: 500 }).length, audit, 'no schema or account change rides along');
  assert.equal(w.actor, 'local', 'the engine actor is put back');
  assert.equal(w.listEntities(table.id).length, 1);
});

test('a default fills a field the submitter left out', () => {
  const { w, form } = feedbackWorkspace();
  const made = submitForm(w, form.id, { values: { Headline: 'quiet' } }, { actor: 'eve' });
  assert.equal(w.readEntity(made.id).fields.Mood, 'Happy');
});

test('hidden fields cannot be set by the submitter', () => {
  const { w, form, table } = feedbackWorkspace();
  for (const key of ['Reporter', 'Build', 'filed at']) {
    assert.throws(() => submitForm(w, form.id, { values: { Headline: 'x', [key]: 'forged' } }, { actor: 'mallory' }),
      (err) => err instanceof WeaveError && err.code === 'forbidden' && /filled by the server/.test(err.message), key);
  }
  assert.equal(w.listEntities(table.id).length, 0, 'a refused submission writes nothing');
});

test('a field the form does not show is refused, so a form cannot reach past itself', () => {
  const { w, form, table } = feedbackWorkspace();
  assert.throws(() => submitForm(w, form.id, { values: { Headline: 'x', Status: 'Done' } }, { actor: 'mallory' }),
    (err) => err instanceof WeaveError && err.code === 'invalid' && /not on the form/.test(err.message));
  assert.equal(w.listEntities(table.id).length, 0);
});

test('a disabled form refuses', () => {
  const { w, form, table } = feedbackWorkspace();
  w.updateEntity(form.id, { Enabled: false });
  assert.throws(() => submitForm(w, form.id, { values: { Headline: 'x' } }, { actor: 'dana' }),
    (err) => err instanceof WeaveError && err.code === 'forbidden' && /turned off/.test(err.message));
  assert.equal(w.listEntities(table.id).length, 0);
});

test('a form on a trashed table says so instead of writing somewhere else', () => {
  const { w, form } = feedbackWorkspace();
  w.deleteTable('Support/Feedback');
  assert.throws(() => submitForm(w, form.id, { values: { Headline: 'x' } }, { actor: 'dana' }), (err) => err instanceof WeaveError && err.code === 'not-found');
});

test('the bug reporter is the first form: it files into Development/Issue and keeps its four symptoms', () => {
  const docs = new Weave();
  seedWeaver(docs);
  const bug = ensureBugForm(docs);
  assert.equal(bug.name, BUG_FORM_NAME);
  assert.equal(bug.kind, 'Bug report');
  assert.equal(bug.table, 'Development/Issue');
  assert.equal(ensureBugForm(docs).id, bug.id, 'seeding twice keeps one form');
  assert.equal(listForms(docs).filter((f) => f.name === BUG_FORM_NAME).length, 1);
  const made = submitForm(docs, bug.id, { categories: ['slow', 'error'], note: 'grid froze', events: [], client: CLIENT },
    { actor: 'dana', server: { version: '1.2.3', startedAt: 'then', uptime: 5, workspace: 'acme' } });
  const e = docs.readEntity(made.id);
  assert.deepEqual(e.fields.Symptom, ['Slow', 'Error']);
  assert.equal(made.severity, 'High');
  assert.match(e.docs.Description, /## Replay/);
  assert.match(e.docs.Description, /1\.2\.3/, 'the server version stamp rides into the Issue');
  assert.equal(e.createdBy, 'dana');
  assert.throws(() => submitForm(docs, bug.id, { values: { Severity: 'Low' }, note: 'forge' }, { actor: 'x' }), (err) => err.code === 'forbidden');
});

test('the form page is rendered from the row: its labels in order, its submit door, and a theme script for both themes', () => {
  const { w, form } = feedbackWorkspace();
  const html = renderFormPage(getForm(w, form.id), { mount: '/w/acme' });
  const at = (s) => html.indexOf(s);
  assert.ok(at('Headline') > 0 && at('Headline') < at('How do you feel') && at('How do you feel') < at('Anything else'), 'labels in the form row order');
  assert.ok(!html.includes('Reporter') && !html.includes('Filed At'), 'hidden fields are not on the page');
  assert.match(html, new RegExp(`data-submit="/w/acme/api/forms/${form.id}/submit"`));
  assert.match(html, /<option[^>]*selected[^>]*>Happy<\/option>/, 'the default is preselected');
  assert.match(html, /href="\/vendor\/tabler\.min\.css"/, 'styled on Tabler, so data-bs-theme carries both themes');
  assert.match(html, /<script src="\/form\.js"><\/script>/);
  const js = read('public/form.js');
  assert.match(js, /weave-theme/, 'the page reads the same theme preference as the app');
  assert.match(js, /bsTheme/);
  assert.doesNotThrow(() => new Function(js), 'form.js parses');
  assert.ok(!/<script>/.test(html), 'no inline script');
});

let base, server, acme, observerToken, editorToken, architectToken, feedbackForm;

test.before(async () => {
  const docs = new Weave();
  seedWeaver(docs);
  ({ w: acme, form: feedbackForm } = feedbackWorkspace());
  observerToken = acme.createAccount({ name: 'olive', role: 'observer' }).token;
  editorToken = acme.createAccount({ name: 'eddie', role: 'editor' }).token;
  architectToken = acme.createAccount({ name: 'archie', role: 'architect' }).token;
  acme.setRequireAuth(true);
  ({ server } = await startServer(new Weave(), { port: 0, workspaces: { weave: docs, acme } }));
  base = `http://127.0.0.1:${server.address().port}`;
  feedbackForm = getForm(acme, 'Tell us');
});
test.after(() => server.close());

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, headers: res.headers };
};

test('routes: an Observer submits and gets one row', async () => {
  const before = acme.listEntities(acme.getTable('Support/Feedback').id).length;
  const r = await call('POST', `/w/acme/api/forms/${feedbackForm.id}/submit`, { token: observerToken, body: { values: { Headline: 'from an observer' } } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.table, 'Support/Feedback');
  assert.equal(acme.listEntities(acme.getTable('Support/Feedback').id).length, before + 1);
  const e = acme.readEntity(r.data.id);
  assert.equal(e.createdBy, 'olive', 'the submitter is the actor');
  assert.equal(e.fields.Reporter, 'olive');
});

test('routes: an Observer cannot write the table directly', async () => {
  const r = await call('POST', '/w/acme/api/tables/Support%2FFeedback/entities', { token: observerToken, body: { name: 'sneaky' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'forbidden');
  const id = acme.listEntities(acme.getTable('Support/Feedback').id)[0]?.id;
  if (id) assert.equal((await call('PATCH', `/w/acme/api/entities/${id}`, { token: observerToken, body: { Name: 'edited' } })).status, 403);
});

test('routes: hidden fields and a disabled form refuse with the one error contract', async () => {
  const hidden = await call('POST', `/w/acme/api/forms/${feedbackForm.id}/submit`, { token: observerToken, body: { values: { Headline: 'x', Reporter: 'someone else' } } });
  assert.equal(hidden.status, 403);
  assert.equal(hidden.data.code, 'forbidden');
  assert.match(hidden.data.error, /filled by the server/);
  const off = createForm(acme, { name: 'Closed', table: 'Support/Feedback', fields: [{ field: 'Name' }], enabled: false });
  const closed = await call('POST', `/w/acme/api/forms/${off.id}/submit`, { token: observerToken, body: { values: { Name: 'x' } } });
  assert.equal(closed.status, 403);
  assert.match(closed.data.error, /turned off/);
});

test('routes: signed out, a form asks for sign-in unless it is anonymous and the operator allows that', async () => {
  const open = createForm(acme, { name: 'Open door', table: 'Support/Feedback', fields: [{ field: 'Name' }], floor: 'Anonymous' });
  assert.equal((await call('POST', `/w/acme/api/forms/${feedbackForm.id}/submit`, { body: { values: { Headline: 'x' } } })).status, 401);
  assert.equal((await call('POST', `/w/acme/api/forms/${open.id}/submit`, { body: { values: { Name: 'x' } } })).status, 401, 'anonymous needs the operator switch too');
  const { w: other, form: guarded } = feedbackWorkspace();
  const lobby = createForm(other, { name: 'Lobby', table: 'Support/Feedback', fields: [{ field: 'Name' }], floor: 'Anonymous' });
  other.createAccount({ name: 'owner', role: 'architect' });
  other.setRequireAuth(true);
  process.env.WEAVE_ANONYMOUS_FORMS = '1';
  const { server: s2 } = await startServer(new Weave(), { port: 0, workspaces: { acme: other } });
  try {
    const at = `http://127.0.0.1:${s2.address().port}`;
    const id = (f) => getForm(other, f.name).id;
    const post = (ref, values) => fetch(`${at}/w/acme/api/forms/${ref}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    const ok = await post(id(lobby), { Name: 'anon' });
    assert.equal(ok.status, 201);
    assert.equal(other.readEntity((await ok.json()).id).createdBy, 'anonymous', 'a signed-out submitter is named as such');
    assert.equal((await post(id(guarded), { Headline: 'x' })).status, 401, 'an Observer-floor form still wants a sign-in');
    const page = await fetch(`${at}/w/acme/f/${id(lobby)}`);
    assert.equal(page.status, 200, 'the anonymous form page opens signed out');
    assert.equal((await fetch(`${at}/w/acme/f/${id(guarded)}`, { redirect: 'manual' })).status, 401, 'an Observer-floor page shows the wall');
  } finally {
    delete process.env.WEAVE_ANONYMOUS_FORMS;
    s2.close();
  }
});

test('routes: GET /f/<id> renders the form page from the row; GET /api/forms/<id> answers its definition', async () => {
  const page = await call('GET', `/w/acme/f/${feedbackForm.id}`, { token: observerToken });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.data, /How do you feel/);
  const def = await call('GET', `/w/acme/api/forms/${feedbackForm.id}`, { token: observerToken });
  assert.equal(def.status, 200);
  assert.deepEqual(def.data.fields.map((f) => f.field), ['Name', 'Mood', 'Notes']);
  const list = await call('GET', '/w/acme/api/forms', { token: observerToken });
  assert.ok(list.data.some((f) => f.id === feedbackForm.id));
  assert.equal((await call('GET', '/w/acme/f/00000000-0000-4000-8000-000000000000', { token: observerToken })).status, 404);
});

test('routes: a form row is schema, so neither an Editor nor an Observer can make one', async () => {
  const body = { name: 'Rogue', values: { Fields: '[{"field":"Name"}]' } };
  for (const token of [editorToken, observerToken]) {
    const r = await call('POST', '/w/acme/api/tables/Workspace%2FForms/entities', { token, body });
    assert.ok([401, 403].includes(r.status), `refused, got ${r.status}`);
  }
  assert.ok(!listForms(acme).some((f) => f.name === 'Rogue'));
});

test('a workspace that made forms before it joined a hub keeps them at the hub root', () => {
  const r = listForms(acme).find((f) => f.name === 'Tell us');
  assert.ok(r, 'the form moved into the root registry');
  assert.equal(r.table, 'Support/Feedback');
});

test('routes: the bug reporter submits through the form, and the form page shows its four symptoms', async () => {
  const r = await call('POST', '/api/bug-report', { body: { categories: ['slow'], note: 'through the form', events: [], client: CLIENT } });
  assert.equal(r.status, 201);
  const forms = await call('GET', '/w/weave/api/forms');
  const bug = forms.data.find((f) => f.name === BUG_FORM_NAME);
  assert.ok(bug, 'the bug form is seeded on the weave docs workspace');
  assert.equal(bug.table, 'Development/Issue');
  const page = await call('GET', `/w/weave/f/${bug.id}`);
  assert.equal(page.status, 200);
  for (const s of ['Slow', 'Looks broken', 'Wrong data', 'Error']) assert.match(page.data, new RegExp(s));
  assert.match(page.data, /src="\/bug-core\.js"/, 'the bug page reuses the recorder module for its client context');
  const direct = await call('POST', `/w/weave/api/forms/${bug.id}/submit`, { body: { categories: ['error'], note: 'via /f/', events: [], client: CLIENT } });
  assert.equal(direct.status, 201);
  assert.equal(direct.data.table, 'Development/Issue');
  assert.deepEqual(direct.data.symptoms, ['Error']);
});

test('every door: the route, the MCP tool and the CLI verb exist and agree', () => {
  const tool = TOOLS.find((t) => t.name === 'weave_form_submit');
  assert.ok(tool, 'weave_form_submit is an MCP tool');
  assert.ok(tool.inputSchema.properties.form && tool.inputSchema.properties.values);
  assert.match(read('src/mcp.js'), /case 'weave_form_submit'/);
  const cli = read('bin/weave.js');
  const block = cli.slice(cli.indexOf("case 'form'"), cli.indexOf("case 'form'") + 1500);
  assert.ok(cli.includes("case 'form'") && block.includes("'submit'"), 'weave form submit');
  const routes = read('src/routes.js');
  assert.ok(routes.includes('/^\\/api\\/forms\\/([^/]+)\\/submit$/'), 'POST /api/forms/:id/submit');
  const agents = read('AGENTS.md');
  assert.match(agents, /weave_form_submit/);
  assert.match(agents, /weave form submit/);
});

test('the MCP tool submits one row as the caller', () => {
  const { w, form } = feedbackWorkspace();
  w.actor = 'agent-7';
  const made = dispatchTool(w, 'weave_form_submit', { form: 'Tell us', values: { Headline: 'from mcp' } });
  assert.equal(w.readEntity(made.id).createdBy, 'agent-7');
  assert.equal(w.readEntity(made.id).fields.Reporter, 'agent-7');
  assert.throws(() => dispatchTool(w, 'weave_form_submit', { form: form.id, values: { Reporter: 'x' } }), /filled by the server/);
});

test('the Handbook carries a Forms guide', () => {
  const src = read('src/handbook.js');
  const at = src.indexOf("name: 'Forms',");
  assert.ok(at > 0, 'a guide named Forms');
  const doc = src.slice(at, at + 4000);
  assert.match(doc, /Workspace\/Forms/);
  assert.match(doc, /weave_form_submit/);
  assert.match(doc, /weave form submit/);
});
