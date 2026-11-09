import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './lib/fixtures.mjs';
import { Weave, fileHeaders } from '../src/engine.js';
await import('../public/board-core.js');

test('introduction presentation is single-file, persisted and preserves field and table identities', () => {
  const w = new Weave();
  w.createSpace({ name: 'Docs' });
  const t = w.createTable({ space: 'Docs', name: 'Page' });
  assert.throws(() => w.addField(t, { name: 'Invalid', type: 'attachments', config: { preview: 'intro' } }), /single-file/);
  const f = w.addField(t, { name: 'Introduction', type: 'attachments', config: { multiple: false, preview: 'intro' } });
  w.updateTable(t.id, { bodyOrder: ['Introduction', '@values', 'Description'] });
  const dump = w.exportJSON({ fileBlobs: true });
  const restored = new Weave();
  restored.importJSON(dump);
  const table = restored.getTable(t.id);
  assert.equal(table.fields[f.id].config.preview, 'intro');
  assert.deepEqual(restored.bodyBlocks(t.id).slice(0, 3), ['Introduction', '@values', 'Description']);
  assert.throws(() => restored.updateField(t.id, f.id, { config: { multiple: true } }), /single-file/);
  w.createEntity(t, { name: 'Example stays in source' });
  const target = new Weave();
  w.useTemplate('Docs', target);
  assert.equal(Object.values(target.getTable('Page').fields).find(x => x.name === 'Introduction').config.preview, 'intro');
  assert.deepEqual(target.bodyBlocks('Page').slice(0, 3), ['Introduction', '@values', 'Description']);
  assert.equal(target.query('Page').total, 0);
  const schema = w.describeSchema();
  const fresh = new Weave();
  fresh.applySchema(schema);
  assert.equal(Object.values(fresh.getTable('Page').fields).find(x => x.name === 'Introduction').config.preview, 'intro');
  w.updateField(t.id, f.id, { name: 'Welcome' });
  assert.equal(w.getTable(t.id).fields[f.id].name, 'Welcome');
  assert.deepEqual(w.bodyBlocks(t.id).slice(0, 3), ['Welcome', '@values', 'Description']);
});

test('SVG covers use an inert explicit image view and leave the download unchanged', () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 2"><script>parent.evil=1</script><rect width="10" height="2"/></svg>');
  const meta = { name: 'rope.svg', mime: 'image/svg+xml' };
  assert.equal(fileHeaders(meta, bytes)['Content-Type'], 'application/octet-stream');
  const headers = fileHeaders(meta, bytes, { view: true });
  assert.equal(headers['Content-Type'], 'image/svg+xml');
  assert.equal(headers['Content-Security-Policy'], "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(fileHeaders(meta, Buffer.from('<html>fake</html>'), { view: true })['Content-Type'], 'application/octet-stream');
  const file = { id: 'art', mime: meta.mime };
  assert.equal(globalThis.weaveBoardCore.coverOf({ fields: [{ name: 'Header', type: 'attachments', preview: 'cover' }] }, { raw: { Header: ['art'] }, files: [file] }), file);
});


test('the API persists intro presentation and body ordering through supported schema routes', async () => {
  const w = new Weave();
  w.createSpace({ name: 'API docs' });
  const table = w.createTable({ space: 'API docs', name: 'Page' });
  await withServer(w, async ({ base }) => {
    const field = await fetch(`${base}/api/tables/${table.id}/fields`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Introduction', type: 'attachments', config: { multiple: false, preview: 'intro' } }),
    });
    assert.equal(field.status, 201);
    const order = await fetch(`${base}/api/tables/${table.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyOrder: ['Introduction', '@values', 'Description'] }),
    });
    assert.equal(order.status, 200);
    const schema = await (await fetch(`${base}/api/schema`)).json();
    const saved = schema.flatMap(s => s.tables).find(t => t.id === table.id);
    assert.equal(saved.fields.find(f => f.name === 'Introduction').preview, 'intro');
    assert.deepEqual(saved.bodyBlocks.slice(0, 3), ['Introduction', '@values', 'Description']);
  });
});
