import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  return { w, tasks };
}

test('every table gets a default Description document field', () => {
  const { w, tasks } = build();
  const db = w.getTable(tasks);
  const fields = w.documentFields(db);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].name, 'Description');
  // The name is only the seed. Without the role, this assertion cannot tell
  // the engine that MEANS it from the one that guessed (test/description-field).
  assert.equal(db.descriptionFieldId, fields[0].id);
});

test('multiple document fields per entity', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Spec', type: 'document' });
  w.addField(tasks, { name: 'Meeting Notes', type: 'document' });

  const e = w.createEntity(tasks, {
    name: 'T',
    doc: 'Default description body',
    docs: { Spec: '# Spec\n\nRequirements here.' },
  });

  assert.equal(w.getDoc(e.id), 'Default description body');
  assert.equal(w.getDoc(e.id, 'Description'), 'Default description body');
  assert.match(w.getDoc(e.id, 'Spec'), /Requirements here/);
  assert.equal(w.getDoc(e.id, 'Meeting Notes'), '');

  w.setDoc(e.id, 'Notes from standup', 'Meeting Notes');
  w.appendDoc(e.id, 'Follow-up item.', 'Meeting Notes');
  assert.equal(w.getDoc(e.id, 'Meeting Notes'), 'Notes from standup\n\nFollow-up item.');

  // Docs are visible in reads, writable via updateEntity like any field.
  const read = w.readEntity(e.id);
  assert.equal(read.docs.Spec, '# Spec\n\nRequirements here.');
  assert.equal(read.doc, 'Default description body'); // default-field compat
  assert.equal(read.fields.Spec, '# Spec\n\nRequirements here.');
  w.updateEntity(e.id, { Spec: 'replaced' });
  assert.equal(w.getDoc(e.id, 'Spec'), 'replaced');

  // Unknown/non-document fields rejected.
  assert.throws(() => w.getDoc(e.id, 'Name'), /not a document field/);

  // Search covers every document field.
  assert.equal(w.search('standup')[0].name, 'T');

  // Deleting a document field drops its content.
  w.deleteField(tasks, 'Spec');
  assert.throws(() => w.getDoc(e.id, 'Spec'), /not a document field/);
});

test('v1 workspace migrates: databases key and entity.doc', () => {
  const w1 = new Weave();
  w1.createSpace({ name: 'S' });
  const t = w1.createTable({ space: 'S', name: 'Item' });
  const e = w1.createEntity(t, { name: 'X', doc: 'legacy body' });

  // Fabricate a v1-shaped dump: tables→databases, docs→doc, no document field.
  const dump = w1.exportJSON();
  dump.version = 1;
  dump.databases = dump.tables;
  delete dump.tables;
  for (const db of Object.values(dump.databases)) {
    for (const [fid, f] of Object.entries(db.fields)) {
      if (f.type === 'document') {
        delete db.fields[fid];
        db.fieldOrder = db.fieldOrder.filter((id) => id !== fid);
      }
    }
  }
  for (const ent of Object.values(dump.entities)) {
    ent.doc = 'legacy body';
    delete ent.docs;
  }

  const w2 = new Weave();
  w2.importJSON(dump);
  assert.equal(w2.state.version, 2);
  assert.equal(w2.getDoc(e.id), 'legacy body');
  assert.equal(w2.documentFields(w2.getTable('Item'))[0].name, 'Description');
  assert.equal(w2.getTable('Item').descriptionFieldId, w2.documentFields(w2.getTable('Item'))[0].id,
    'a v1 workspace comes up with the role set, not merely the field');
});

test('universalSearch returns permalinks for all kinds', () => {
  const { w, tasks } = build();
  w.createEntity(tasks, { name: 'Product launch task' });
  const hits = w.universalSearch('product');
  const kinds = new Set(hits.map((h) => h.kind));
  assert.ok(kinds.has('space'));
  assert.ok(kinds.has('table'));
  assert.ok(kinds.has('entity'));
  const space = hits.find((h) => h.kind === 'space');
  assert.match(space.url, /^\/#\/space\//);
  const table = hits.find((h) => h.kind === 'table');
  assert.match(table.url, /^\/#\/table\//);
  const entity = hits.find((h) => h.kind === 'entity');
  assert.match(entity.url, /^\/e\//);
  // Workspace name match
  const ws = w.universalSearch('Weave Workspace');
  assert.equal(ws[0].kind, 'workspace');
  assert.equal(ws[0].url, '/');
});

test('describeAutomations resolves names for the map', () => {
  const { w, tasks } = build();
  w.addField(tasks, {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  w.createAutomation(tasks, {
    name: 'notify',
    trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
    actions: [
      { type: 'append-doc', text: 'done' },
      { type: 'webhook', url: 'http://127.0.0.1:9/hook' },
    ],
  });
  const [a] = w.describeAutomations();
  assert.equal(a.table, 'Product/Task');
  assert.deepEqual(a.trigger, { type: 'state-changed', field: 'State', toState: 'Done' });
  assert.equal(a.actions[0].field, 'Description');
  assert.equal(a.actions[1].type, 'webhook');
});

test('append-doc automation can target a named document field', () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Log', type: 'document' });
  w.createAutomation(tasks, {
    name: 'log create',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'append-doc', field: 'Log', text: 'created {{Name}}' }],
  });
  const e = w.createEntity(tasks, { name: 'Widget' });
  assert.equal(w.getDoc(e.id, 'Log'), 'created Widget');
  assert.equal(w.getDoc(e.id), ''); // Description untouched
});

test('HTTP: per-field doc endpoints and universal search', async () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Spec', type: 'document' });
  const e = w.createEntity(tasks, { name: 'Widget task', doc: 'main body', docs: { Spec: '# The spec' } });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const md = await (await fetch(`${base}/e/${e.id}/doc/Spec.md`)).text();
    assert.match(md, /The spec/);
    const html = await (await fetch(`${base}/e/${e.id}/doc/Spec.html`)).text();
    assert.match(html, /<h1>The spec<\/h1>/);
    const pdf = Buffer.from(await (await fetch(`${base}/e/${e.id}/doc/Spec.pdf`)).arrayBuffer());
    assert.ok(pdf.toString('latin1').startsWith('%PDF-1.4'));
    const defaultMd = await (await fetch(`${base}/e/${e.id}/doc.md`)).text();
    assert.equal(defaultMd, 'main body');

    // API doc write to a named field
    await fetch(`${base}/api/entities/${e.id}/doc`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'Spec', doc: 'rewritten' }),
    });
    const got = await (await fetch(`${base}/api/entities/${e.id}/doc?field=Spec`)).json();
    assert.equal(got.doc, 'rewritten');

    // Whole-entity PDF: fields summary + one page per document field.
    const entPdf = Buffer.from(await (await fetch(`${base}/e/${e.id}/entity.pdf`)).arrayBuffer()).toString('latin1');
    assert.ok(entPdf.startsWith('%PDF-1.4'));
    const pageCount = Number(entPdf.match(/\/Count (\d+)/)[1]);
    assert.ok(pageCount >= 3, `expected ≥3 pages (fields + 2 docs), got ${pageCount}`);

    const search = await (await fetch(`${base}/api/search?q=widget`)).json();
    assert.ok(search.some((h) => h.kind === 'entity' && h.url.startsWith('/e/')));
    const tables = await (await fetch(`${base}/api/search?q=task`)).json();
    assert.ok(tables.some((h) => h.kind === 'table' && h.url.includes('#/table/')));
  } finally {
    server.close();
  }
});

/* A document can be an app. When the stored text is itself a complete HTML
   document (a slide deck, an interactive figure), the .html endpoint serves
   it verbatim — no markdown page skeleton around it, no block splitting at
   blank lines — so its own <style> and <script> run as written. */
test('HTTP: a document that is an HTML document is served verbatim', async () => {
  const { w, tasks } = build();
  w.addField(tasks, { name: 'Slides', type: 'document' });
  const deck = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<style>\nbody{background:#181310}\n\n.x{color:red}\n</style>\n</head>\n<body>\n<div id="canvas">hi</div>\n\n<script>\nconst fs=()=>document.documentElement.requestFullscreen();\n</script>\n</body>\n</html>\n';
  const e = w.createEntity(tasks, { name: 'Deck', doc: '# plain markdown', docs: { Slides: deck } });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/e/${e.id}/doc/Slides.html`);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(await res.text(), deck, 'byte-for-byte the stored document');
    // Markdown documents still get the page skeleton.
    const md = await (await fetch(`${base}/e/${e.id}/doc/Description.html`)).text();
    assert.match(md, /<h1>plain markdown<\/h1>/);
    assert.match(md, /<!doctype html>/i);
    // The raw .md export is untouched either way.
    assert.equal(await (await fetch(`${base}/e/${e.id}/doc/Slides.md`)).text(), deck);
  } finally {
    server.close();
  }
});
