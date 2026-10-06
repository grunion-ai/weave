import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createServer } from '../src/server.js';
import { fresh } from './lib/fixtures.mjs';

/* The universal reference rule (Kyle, 2026-08-24): every entity — the
   workspace itself, spaces, tables, rows — is REFERENCED by its unique id
   and carries an id-based permalink. Names are display labels: rename
   anything and every stored reference and every permalink still resolves.
   This is what makes the model extensible — new kinds get durable identity
   for free by following the same rule. */

const listen = (srv) => new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
const req = async (port, path, opts = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text };
};

test('the workspace itself has a unique id, minted once and kept forever', () => {
  const w = fresh();
  const id = w.state.meta.id;
  assert.match(id, /^[0-9a-f-]{36}$/, 'a uuid');
  // The id survives the interchange format and a rename.
  const json = w.exportJSON();
  const w2 = new Weave();
  w2.importJSON(json);
  assert.equal(w2.state.meta.id, id, 'import keeps the identity');
  w2.state.meta.name = 'renamed';
  assert.equal(w2.state.meta.id, id, 'a rename never touches it');
  // A legacy workspace without one grows one on load.
  delete json.meta.id;
  const w3 = new Weave();
  w3.importJSON(json);
  assert.match(w3.state.meta.id, /^[0-9a-f-]{36}$/);
});

test('every level answers to its id and reports an id-based permalink', () => {
  const w = fresh();
  const space = w.getSpace('Dev');
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });

  // ids resolve regardless of names…
  w.updateSpace(space.id, { name: 'Engineering' });
  w.updateTable(db.id, { name: 'Story' });
  w.updateEntity(row.id, { Name: 'ship it' });
  assert.equal(w.getSpace(space.id).name, 'Engineering');
  assert.equal(w.getTable(db.id).name, 'Story');
  assert.equal(w.readEntity(row.id).name, 'ship it');

  // …and every read carries the permalink, built from the id alone.
  assert.equal(w.readEntity(row.id).url, `/e/${row.id}`);
  const schema = w.describeSchema();
  const sp = schema.find((x) => x.spaceId === space.id);
  assert.equal(sp.url, `#/space/${space.id}`);
  const tb = sp.tables.find((x) => x.id === db.id);
  assert.equal(tb.url, `#/table/${db.id}`);
});

test('GET /api/workspace exposes the id and its permalink', async () => {
  const srv = createServer(fresh());
  const port = await listen(srv);
  try {
    const { json } = await req(port, '/api/workspace');
    assert.match(json.id, /^[0-9a-f-]{36}$/);
    assert.equal(json.url, `/w/${json.id}/`, 'the canonical workspace permalink is id-based');
  } finally { srv.close(); }
});

test('/w/<workspace-id>/ routes to the workspace, before and after a rename', async () => {
  const w = fresh();
  const srv = createServer(w);
  const port = await listen(srv);
  try {
    const id = w.state.meta.id;
    const byId = await req(port, `/w/${id}/api/workspace`);
    assert.equal(byId.status, 200);
    assert.equal(byId.json.id, id);

    // Rename through the API: the name alias moves, the id URL never does.
    const oldName = w.state.meta.name;
    await req(port, '/api/workspace', { method: 'PATCH', body: JSON.stringify({ name: 'renamedws' }) });
    const still = await req(port, `/w/${id}/api/workspace`);
    assert.equal(still.status, 200, 'the id permalink survives the rename');
    assert.equal(still.json.name, 'renamedws');
    const newAlias = await req(port, '/w/renamedws/api/workspace');
    assert.equal(newAlias.status, 200, 'the friendly name still works as an alias');
    assert.notEqual(oldName, 'renamedws');
  } finally { srv.close(); }
});

test('the workspace list carries ids and id-based urls', async () => {
  const srv = createServer(fresh());
  const port = await listen(srv);
  try {
    const { json } = await req(port, '/api/workspaces');
    for (const ws of json) {
      assert.match(ws.id, /^[0-9a-f-]{36}$/, `${ws.name} has an id`);
      assert.equal(ws.url, `/w/${ws.id}/`, `${ws.name} advertises its id permalink`);
    }
  } finally { srv.close(); }
});

test('mentions resolve by id, so a rename never breaks a document', () => {
  const w = fresh();
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });
  const doc = w.createEntity(db.id, { Name: 'notes' });
  w.setDoc(doc.id, `See [[${row.id}]] and [[table:${db.id}]] and [[space:${w.getSpace('Dev').id}]].`);

  const before = w.readEntity(doc.id);
  // Rename everything the mentions point at.
  w.updateEntity(row.id, { Name: 'ship it' });
  w.updateTable(db.id, { name: 'Story' });
  w.updateSpace('Dev', { name: 'Engineering' });

  // The doc text is untouched (ids), and resolution follows the renames.
  assert.equal(w.readEntity(doc.id).docs.Description, before.docs.Description);
  const html = w.renderDoc ? null : null; // resolution is exercised through the server below
});

test('the server renders id mentions as live links with the CURRENT names', async () => {
  const w = fresh();
  const db = w.getTable('Task');
  const row = w.createEntity(db.id, { Name: 'ship' });
  const srv = createServer(w);
  const port = await listen(srv);
  try {
    const doc = w.createEntity(db.id, { Name: 'notes' });
    w.setDoc(doc.id, `See [[${row.id}]] and [[table:${db.id}]].`);
    w.updateEntity(row.id, { Name: 'renamed row' });
    w.updateTable(db.id, { name: 'Story' });
    const { text } = await req(port, `/e/${doc.id}/doc.html`);
    assert.match(text, /renamed row/, 'the entity mention shows the current name');
    assert.match(text, /Story/, 'the table mention shows the current name');
    assert.match(text, new RegExp(row.id), 'and links by id');
  } finally { srv.close(); }
});

/* ---------- rich link previews (Feature #264) ----------
   The uuid stays the address; the preview does the reading. A permalink
   answers 200 with the app shell and a server-rendered head that a link
   fetcher (Slack, Messages, iMessage) reads without running script, then
   the shell moves itself to the hash route the app already knows. */

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SVG_LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>').toString('base64');

const decode = (s) => s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The content of <meta property|name="key" content="…">, decoded; null when absent.
const metaOf = (html, key) => {
  const m = html.match(new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const titleOf = (html) => decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
const routeOf = (html) => { const m = html.match(/<meta name="weave-route" content="([^"]*)"/); return m ? decode(m[1]) : null; };

/* A docs-shaped member workspace, Acme Docs › Development › Issue, beside
   the default one, so every address carries a /w/<slug> prefix. */
function previewHub({ requireAuth = false } = {}) {
  const root = fresh();
  const w = new Weave();
  w.updateWorkspace({ name: 'Acme Docs' });
  const space = w.createSpace({ name: 'Development' });
  const issue = w.createTable({ space: 'Development', name: 'Issue' });
  w.addField(issue.id, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' },
  ] } });
  w.addField(issue.id, { name: 'Severity', type: 'text' });
  w.addField(issue.id, { name: 'Symptom', type: 'text' });
  w.addField(issue.id, { name: 'Secret', type: 'text' });
  const row = w.createEntity(issue.id, { Name: 'Totals <drift> & "rounding"', Severity: 'Medium', Symptom: 'Wrong data', Secret: 'classified-detail' });
  w.setState(row.id, 'Status', 'Fixed');
  if (requireAuth) w.setRequireAuth(true);
  return { root, w, space, issue, row };
}
async function previewServer(opts = {}, serverOpts = {}) {
  const h = previewHub(opts);
  const srv = createServer(h.root, { workspaces: { 'acme-docs': h.w }, ...serverOpts });
  const port = await listen(srv);
  const base = `http://127.0.0.1:${port}`;
  const get = async (path, headers = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', headers });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  return { ...h, srv, base, get };
}

test('an entity permalink answers 200 with the shell and the exact preview head', async () => {
  const s = await previewServer();
  try {
    const r = await s.get(`/w/acme-docs/e/${s.row.id}`);
    assert.equal(r.status, 200, 'no bare 302: a fetcher reads this page');
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = r.text;
    assert.equal(titleOf(html), 'Issue #1 · Totals <drift> & "rounding" · Acme Docs');
    assert.equal(metaOf(html, 'og:title'), 'Issue #1 · Totals <drift> & "rounding"');
    assert.equal(metaOf(html, 'og:description'), 'Acme Docs › Development › Issue\nStatus Fixed · Severity Medium · Symptom Wrong data');
    assert.equal(metaOf(html, 'description'), metaOf(html, 'og:description'));
    assert.equal(metaOf(html, 'og:site_name'), 'Acme Docs');
    assert.equal(metaOf(html, 'og:url'), `${s.base}/w/acme-docs/e/${s.row.id}`);
    assert.equal(metaOf(html, 'og:type'), 'article');
    assert.equal(metaOf(html, 'og:image'), `${s.base}/brand/weave-mark-512.png`, 'no logo: the bundled raster mark');
    assert.equal(metaOf(html, 'twitter:card'), 'summary');
    assert.deepEqual([1, 2, 3].map((i) => [metaOf(html, `twitter:label${i}`), metaOf(html, `twitter:data${i}`)]),
      [['Status', 'Fixed'], ['Severity', 'Medium'], ['Symptom', 'Wrong data']]);
    assert.equal(metaOf(html, 'twitter:label4'), null, 'the preview fields stop at three');
    assert.match(html, /<link rel="icon"/);
    // The jump: the hash route the app knows, by the shell's own script.
    assert.equal(routeOf(html), `/w/acme-docs/#/entity/${s.row.id}`);
    assert.match(html, /<script src="\/permalink\.js[^"]*"><\/script>/);
    assert.match(html, /id="app"/, 'the app shell itself, so a person lands with no second request');
    assert.ok(!html.includes('<drift>'), 'a name never reaches the page unescaped');
    assert.equal((html.match(/<title>/g) ?? []).length, 1, 'one title, the server-rendered one');
  } finally { s.srv.close(); }
});

test('a Table#n ref previews the same row under its canonical uuid address', async () => {
  const s = await previewServer();
  try {
    const r = await s.get('/w/acme-docs/e/Issue%231');
    assert.equal(r.status, 200);
    assert.equal(metaOf(r.text, 'og:title'), 'Issue #1 · Totals <drift> & "rounding"');
    assert.equal(metaOf(r.text, 'og:url'), `${s.base}/w/acme-docs/e/${s.row.id}`);
    assert.equal(routeOf(r.text), `/w/acme-docs/#/entity/${s.row.id}`);
  } finally { s.srv.close(); }
});

test('a long name is cut near 80 characters in og:title', async () => {
  const s = await previewServer();
  try {
    s.w.updateEntity(s.row.id, { Name: 'word '.repeat(40).trim() });
    const t = metaOf((await s.get(`/w/acme-docs/e/${s.row.id}`)).text, 'og:title');
    assert.ok(t.length <= 80, `${t.length} characters`);
    assert.ok(t.startsWith('Issue #1 · word word') && t.endsWith('…'));
  } finally { s.srv.close(); }
});

test('a space and a table get a permalink of the same shape', async () => {
  const s = await previewServer();
  try {
    const sp = await s.get(`/w/acme-docs/s/${s.space.id}`);
    assert.equal(sp.status, 200);
    assert.equal(metaOf(sp.text, 'og:title'), 'Development · space');
    assert.equal(metaOf(sp.text, 'og:description'), 'Acme Docs › Development\n1 table · 1 row');
    assert.equal(metaOf(sp.text, 'og:url'), `${s.base}/w/acme-docs/s/${s.space.id}`);
    assert.equal(titleOf(sp.text), 'Development · space · Acme Docs');
    assert.equal(routeOf(sp.text), `/w/acme-docs/#/space/${s.space.id}`);

    const tb = await s.get(`/w/acme-docs/t/${s.issue.id}`);
    assert.equal(tb.status, 200);
    assert.equal(metaOf(tb.text, 'og:title'), 'Development / Issue · table');
    assert.equal(metaOf(tb.text, 'og:description'), 'Acme Docs › Development › Issue\n1 row');
    assert.equal(metaOf(tb.text, 'og:url'), `${s.base}/w/acme-docs/t/${s.issue.id}`);
    assert.equal(routeOf(tb.text), `/w/acme-docs/#/table/${s.issue.id}`);
    assert.match(tb.text, /id="app"/);
  } finally { s.srv.close(); }
});

test('a table permalink is not swallowed by the task applet mounted at /t', async () => {
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = '1234';
  const s = await previewServer();
  try {
    assert.equal((await s.get(`/w/acme-docs/t/${s.issue.id}`)).status, 200);
    assert.equal((await s.get('/w/acme-docs/t')).status, 200, 'the applet still answers its own mount');
  } finally {
    s.srv.close();
    if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE; else process.env.WEAVE_APPLET_PASSCODE = prior;
  }
});

test('the workspace root carries the head with the workspace title and no jump', async () => {
  const s = await previewServer();
  try {
    const r = await s.get('/w/acme-docs/');
    assert.equal(r.status, 200);
    assert.equal(titleOf(r.text), 'Acme Docs');
    assert.equal(metaOf(r.text, 'og:title'), 'Acme Docs');
    assert.equal(metaOf(r.text, 'og:site_name'), 'Acme Docs');
    assert.equal(metaOf(r.text, 'og:description'), '1 space · 1 table');
    assert.equal(metaOf(r.text, 'og:url'), `${s.base}/w/acme-docs/`);
    assert.equal(routeOf(r.text), null, 'the root is already where the app lives');
    // The description, when the workspace has one, says what it is.
    s.w.updateWorkspace({ description: 'The **docs** for Acme.\n\nMore below.' });
    assert.equal(metaOf((await s.get('/w/acme-docs/')).text, 'og:description'), 'The docs for Acme.');
    // The shell keeps a validator drawn from what it served (Issue #313).
    const again = await s.get('/w/acme-docs/', { 'If-None-Match': r.headers.get('etag') });
    assert.equal(again.status, 200, 'the head changed, so the old validator no longer matches');
  } finally { s.srv.close(); }
});

test('an unknown or deleted ref still renders the branded 404', async () => {
  const s = await previewServer();
  try {
    for (const p of ['/w/acme-docs/e/00000000-0000-4000-8000-000000000000', '/w/acme-docs/e/Issue%2399',
      '/w/acme-docs/s/00000000-0000-4000-8000-000000000000', '/w/acme-docs/t/00000000-0000-4000-8000-000000000000']) {
      const r = await s.get(p);
      assert.equal(r.status, 404, p);
      assert.match(r.text, /Not found — weave/, `${p} is the branded page`);
      assert.equal(metaOf(r.text, 'og:title'), null);
    }
    s.w.deleteEntity(s.row.id);
    const gone = await s.get(`/w/acme-docs/e/${s.row.id}`);
    assert.equal(gone.status, 404, 'a trashed row previews nothing');
    assert.ok(!gone.text.includes('drift'), 'and names nothing');
  } finally { s.srv.close(); }
});

test('og:image is the workspace logo when it is raster, the bundled mark otherwise', async () => {
  const s = await previewServer();
  try {
    assert.equal((await s.get('/brand/weave-mark-512.png')).status, 200, 'the fallback mark is served');
    s.w.setWorkspaceLogo({ name: 'logo.svg', bytes: SVG_LOGO });
    assert.equal(metaOf((await s.get(`/w/acme-docs/e/${s.row.id}`)).text, 'og:image'), `${s.base}/brand/weave-mark-512.png`,
      'Messages and Slack ignore SVG');
    s.w.setWorkspaceLogo({ name: 'logo.png', bytes: PNG_1PX });
    const img = metaOf((await s.get(`/w/acme-docs/e/${s.row.id}`)).text, 'og:image');
    assert.match(img, new RegExp(`^${s.base}/w/acme-docs/api/workspace/logo\\?v=[0-9a-f]{8}$`));
    assert.equal(metaOf((await s.get('/w/acme-docs/')).text, 'og:image'), img, 'the root wears the logo too');
  } finally { s.srv.close(); }
});

/* ---------- the wall and Link preview before sign-in ---------- */

// A provider is configured, so a signed-out browser is sent to sign in.
const PROVIDER = { name: 'TestID', issuer: 'https://id.example.com' };

test('the wall: with the setting off an anonymous permalink is a 302 to sign-in and no meta', async () => {
  const s = await previewServer({ requireAuth: true }, { oidc: PROVIDER });
  try {
    assert.equal(s.w.getWorkspace().linkPreview, false, 'off by default');
    for (const p of [`/w/acme-docs/e/${s.row.id}`, `/w/acme-docs/s/${s.space.id}`, `/w/acme-docs/t/${s.issue.id}`, '/w/acme-docs/']) {
      const r = await s.get(p);
      assert.equal(r.status, 302, p);
      assert.match(r.headers.get('location'), /^\/w\/acme-docs\/auth\?next=/);
      assert.equal(metaOf(r.text, 'og:title'), null);
    }
    assert.equal((await s.get('/w/acme-docs/api/workspace/logo')).status, 401, 'the logo stays behind the wall');
  } finally { s.srv.close(); }
});

test('the wall: with the setting on an anonymous permalink gets the head only, then the sign-in jump', async () => {
  const s = await previewServer({ requireAuth: true }, { oidc: PROVIDER });
  try {
    s.w.updateWorkspace({ linkPreview: true });
    s.w.setWorkspaceLogo({ name: 'logo.png', bytes: PNG_1PX });
    const r = await s.get(`/w/acme-docs/e/${s.row.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(metaOf(r.text, 'og:title'), 'Issue #1 · Totals <drift> & "rounding"');
    assert.equal(metaOf(r.text, 'og:description'), 'Acme Docs › Development › Issue\nStatus Fixed · Severity Medium · Symptom Wrong data');
    assert.equal(metaOf(r.text, 'twitter:data1'), 'Fixed');
    assert.equal(routeOf(r.text), `/w/acme-docs/auth?next=${encodeURIComponent(`/w/acme-docs/e/${s.row.id}`)}`);
    assert.match(r.text, /data-sign-in/);
    assert.ok(!/id="app"|\/app\.js/.test(r.text), 'no app shell: nothing runs that would call the API');
    assert.ok(!r.text.includes('classified-detail'), 'no field past the preview reaches the page');
    // The logo the head names is readable by the fetcher that reads the head.
    const logo = await fetch(metaOf(r.text, 'og:image'));
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    // Spaces, tables and the root preview the same way.
    assert.equal(metaOf((await s.get(`/w/acme-docs/s/${s.space.id}`)).text, 'og:title'), 'Development · space');
    assert.equal(metaOf((await s.get(`/w/acme-docs/t/${s.issue.id}`)).text, 'og:title'), 'Development / Issue · table');
    assert.equal(metaOf((await s.get('/w/acme-docs/')).text, 'og:title'), 'Acme Docs');
    // Everything else stays walled: the API, the documents, an unknown ref.
    assert.equal((await s.get('/w/acme-docs/api/schema')).status, 401);
    assert.equal((await s.get(`/w/acme-docs/e/${s.row.id}/doc.html`)).status, 302);
    assert.equal((await s.get('/w/acme-docs/e/00000000-0000-4000-8000-000000000000')).status, 302, 'a miss says nothing either way');
    // Table#n counts up from 1: signed out, it would list every row's name.
    assert.equal((await s.get('/w/acme-docs/e/Issue%231')).status, 302, 'only the unguessable uuid form previews signed out');
  } finally { s.srv.close(); }
});

test('the wall: a Bearer GET is unchanged by the setting and gets the full shell', async () => {
  const s = await previewServer({ requireAuth: true }, { oidc: PROVIDER });
  try {
    const token = s.w.createAccount({ name: 'eye', role: 'observer' }).token;
    for (const on of [false, true]) {
      s.w.updateWorkspace({ linkPreview: on });
      const r = await s.get(`/w/acme-docs/e/${s.row.id}`, { Authorization: `Bearer ${token}` });
      assert.equal(r.status, 200, `setting ${on ? 'on' : 'off'}`);
      assert.match(r.text, /id="app"/);
      assert.equal(routeOf(r.text), `/w/acme-docs/#/entity/${s.row.id}`);
      assert.ok(!/data-sign-in/.test(r.text));
    }
  } finally { s.srv.close(); }
});

test('Link preview before sign-in is an architect setting on the workspace record', async () => {
  const s = await previewServer({ requireAuth: true }, { oidc: PROVIDER });
  try {
    const admin = s.w.createAccount({ name: 'root', role: 'architect' }).token;
    const editor = s.w.createAccount({ name: 'bot', role: 'editor' }).token;
    const patch = (token, body) => fetch(`${s.base}/w/acme-docs/api/workspace`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await patch(null, { linkPreview: true })).status, 401);
    assert.equal((await patch(editor, { linkPreview: true })).status, 403);
    const ok = await patch(admin, { linkPreview: true });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).linkPreview, true);
    assert.equal(s.w.getWorkspace().linkPreview, true);
    assert.equal(s.w.state.meta.linkPreview, true, 'stored on the workspace row');
  } finally { s.srv.close(); }
});

test('the default workspace: og:url names its slug, the jump keeps the bare root', async () => {
  const w = fresh();
  const row = w.createEntity(w.getTable('Task').id, { Name: 'ship' });
  const srv = createServer(w);
  const port = await listen(srv);
  try {
    const slug = w.state.meta.name;
    for (const [path, route] of [[`/e/${row.id}`, `/#/entity/${row.id}`], [`/w/${slug}/e/${row.id}`, `/w/${slug}/#/entity/${row.id}`]]) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`);
      const html = await r.text();
      assert.equal(r.status, 200, path);
      assert.equal(metaOf(html, 'og:url'), `http://127.0.0.1:${port}/w/${slug}/e/${row.id}`, `${path}: one canonical address`);
      assert.equal(routeOf(html), route, `${path}: the address bar stays under the prefix it came in on`);
    }
  } finally { srv.close(); }
});
