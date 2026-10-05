/* Attachment previews (Kyle, 2026-10-05). An attachments field says how a
   record shows its files: `preview` link | inline | auto | cover, `size`
   small | medium | large, `fit` fill | trim. Unset resolves at render (auto
   for many, inline for one); medium and trim are unmarked; a cover is one
   picture, so only a single-file field is offered it. The dialog core
   mirrors the three lists. An HTML upload shows live under
   `GET /api/files/:id?view`, whose policy keeps it a stranger to the
   workspace: sandboxed with scripts, never same-origin, no remote loads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, ATTACHMENT_PREVIEWS, ATTACHMENT_SIZES, ATTACHMENT_FITS, HTML_VIEW_POLICY, fileHeaders } from '../src/engine.js';
import { startServer } from '../src/server.js';

await import('../public/date-grain.js');
await import('../public/field-dialog-core.js');
const core = globalThis.fieldDialogCore;

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  return w;
}
const view = (w, name) => w.describeSchema().flatMap((sp) => sp.tables).find((t) => t.name === 'Issue').fields.find((f) => f.name === name);
const config = (w, name) => Object.values(w.getTable('Issue').fields).find((f) => f.name === name).config;

test('a bare attachments field carries only multiple; the look keys are unmarked when default', () => {
  const w = fresh();
  w.addField('Issue', { name: 'Files', type: 'attachments' });
  assert.deepEqual(config(w, 'Files'), { multiple: true });
  w.addField('Issue', { name: 'Shots', type: 'attachments', config: { preview: 'inline', size: 'medium', fit: 'trim' } });
  assert.deepEqual(config(w, 'Shots'), { multiple: true, preview: 'inline' }, 'medium and trim are the defaults and are not stored');
  w.addField('Issue', { name: 'Evidence', type: 'attachments', config: { preview: 'auto', size: 'small', fit: 'fill' } });
  assert.deepEqual(config(w, 'Evidence'), { multiple: true, preview: 'auto', size: 'small', fit: 'fill' });
  const v = view(w, 'Evidence');
  assert.equal(v.preview, 'auto'); assert.equal(v.size, 'small'); assert.equal(v.fit, 'fill'); assert.equal(v.multiple, true);
  assert.equal(view(w, 'Files').preview, undefined, 'unset stays unset in the field view; the app resolves it');
});

test('an unknown preview, size or fit is refused by name', () => {
  const w = fresh();
  for (const [key, bad] of [['preview', 'thumb'], ['size', 'huge'], ['fit', 'stretch']]) {
    assert.throws(() => w.addField('Issue', { name: `F ${key}`, type: 'attachments', config: { [key]: bad } }), new RegExp(`${key} '${bad}'`), key);
  }
});

test('a cover needs a single-file field', () => {
  const w = fresh();
  assert.throws(() => w.addField('Issue', { name: 'Hero', type: 'attachments', config: { preview: 'cover' } }), /single-file/);
  w.addField('Issue', { name: 'Hero', type: 'attachments', config: { multiple: false, preview: 'cover' } });
  assert.deepEqual(config(w, 'Hero'), { multiple: false, preview: 'cover' });
  const db = w.getTable('Issue');
  assert.throws(() => w.updateField(db.id, 'Hero', { config: { multiple: true } }), /single-file/, 'flipping multiple on under a cover is refused, not silently kept');
});

test('updateField patches the look lanes and a null clears one', () => {
  const w = fresh();
  w.addField('Issue', { name: 'Files', type: 'attachments' });
  const db = w.getTable('Issue');
  w.updateField(db.id, 'Files', { config: { preview: 'link', size: 'large' } });
  assert.deepEqual(config(w, 'Files'), { multiple: true, preview: 'link', size: 'large' });
  w.updateField(db.id, 'Files', { config: { preview: null, fit: 'fill' } });
  assert.deepEqual(config(w, 'Files'), { multiple: true, size: 'large', fit: 'fill' });
  w.updateField(db.id, 'Files', { config: { size: 'medium', fit: 'trim' } });
  assert.deepEqual(config(w, 'Files'), { multiple: true }, 'a default written back is dropped');
});

test('describeSchema and applySchema carry the look', () => {
  const w = fresh();
  w.addField('Issue', { name: 'Hero', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'large', fit: 'fill' } });
  const doc = w.describeSchema();
  const w2 = new Weave();
  w2.applySchema(doc);
  assert.deepEqual(config(w2, 'Hero'), { multiple: false, preview: 'cover', size: 'large', fit: 'fill' });
  assert.equal(w2.applySchema(doc, { dryRun: true }).changes?.length ?? 0, 0, 'a second apply is a no-op');
});

test('the dialog core mirrors the engine lists and round-trips the look', () => {
  assert.deepEqual(core.ATTACHMENT_PREVIEWS, ATTACHMENT_PREVIEWS);
  assert.deepEqual(core.ATTACHMENT_SIZES, ATTACHMENT_SIZES);
  assert.deepEqual(core.ATTACHMENT_FITS, ATTACHMENT_FITS);
  assert.deepEqual(core.blankState('attachments').files, { preview: '', size: 'medium', fit: 'trim' });
  assert.deepEqual(core.definitionFromState({ type: 'attachments', multiple: true, files: { preview: '', size: 'medium', fit: 'trim' } }).config, {}, 'unset, medium, trim write nothing');
  assert.deepEqual(core.definitionFromState({ type: 'attachments', multiple: false, files: { preview: 'cover', size: 'large', fit: 'fill' } }).config,
    { multiple: false, preview: 'cover', size: 'large', fit: 'fill' });
  const back = core.stateFromDefinition({ type: 'attachments', config: { preview: 'auto', fit: 'fill' } });
  assert.deepEqual(back.files, { preview: 'auto', size: 'medium', fit: 'fill' });
  assert.deepEqual(core.definitionFromFieldView({ type: 'attachments', multiple: true, preview: 'inline', size: 'small' }).config, { multiple: true, preview: 'inline', size: 'small' });
  const patch = core.editPatchConfig({ type: 'attachments' }, { type: 'attachments', config: { preview: 'link' } }, { multiple: true, files: { preview: 'link', size: 'medium', fit: 'trim' } });
  assert.deepEqual(patch, { multiple: true, preview: 'link', size: null, fit: null }, 'every lane is sent, a null clears');
  // The definition pane and the form agree through the serializer.
  const parsed = core.parseDefinition('{"type":"attachments","config":{"multiple":false,"preview":"cover"}}');
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(core.stateFromDefinition(parsed.def).files.preview, 'cover');
});

const HTML = Buffer.from('<!doctype html><p id="p">page</p><script>document.getElementById("p").textContent="ran"</script>');
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

test('fileHeaders: ?view shows an HTML upload under HTML_VIEW_POLICY and changes nothing else', () => {
  const plain = fileHeaders({ name: 'x.html', mime: 'text/html' }, HTML);
  assert.equal(plain['Content-Type'], 'application/octet-stream', 'without ?view an HTML upload still downloads (Issue #483)');
  assert.match(plain['Content-Disposition'], /^attachment;/);
  const shown = fileHeaders({ name: 'x.html', mime: 'text/html; charset=utf-8' }, HTML, { view: true });
  assert.equal(shown['Content-Type'], 'text/html; charset=utf-8');
  assert.match(shown['Content-Disposition'], /^inline;/);
  assert.equal(shown['Content-Security-Policy'], HTML_VIEW_POLICY);
  assert.equal(shown['X-Content-Type-Options'], 'nosniff');
  assert.doesNotMatch(HTML_VIEW_POLICY, /allow-same-origin/, 'the page never shares the workspace origin');
  assert.match(HTML_VIEW_POLICY, /^sandbox allow-scripts/, 'its scripts run');
  assert.match(HTML_VIEW_POLICY, /default-src 'none'/, 'it loads nothing remote');
  for (const [name, mime, bytes] of [['a.png', 'image/png', PNG], ['a.pdf', 'application/pdf', Buffer.from('%PDF-1.4')], ['a.svg', 'image/svg+xml', Buffer.from('<svg/>')], ['a.bin', undefined, HTML]]) {
    assert.deepEqual(fileHeaders({ name, mime }, bytes, { view: true }), fileHeaders({ name, mime }, bytes), `${name}: ?view is ignored for a non-HTML file`);
  }
});

test('GET /api/files/:id?view serves the HTML upload in place; the bare route still downloads it', async () => {
  const w = fresh();
  const e = w.createEntity('Issue', { name: 'Page' });
  const file = w.attachFile(e.id, { name: 'page.html', mime: 'text/html', bytes: HTML });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bare = await fetch(`${base}/api/files/${file.id}`);
    assert.equal(bare.headers.get('content-type'), 'application/octet-stream');
    const shown = await fetch(`${base}/api/files/${file.id}?view`);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(shown.headers.get('content-security-policy'), `${HTML_VIEW_POLICY}; frame-ancestors 'self'`, 'the view policy, plus the frame rule every HTML answer carries');
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), HTML, 'the bytes are unchanged');
    const png = w.attachFile(e.id, { name: 'a.png', mime: 'image/png', bytes: PNG });
    assert.equal((await fetch(`${base}/api/files/${png.id}?view`)).headers.get('content-security-policy'), "sandbox; default-src 'none'");
  } finally { server.close(); }
});
