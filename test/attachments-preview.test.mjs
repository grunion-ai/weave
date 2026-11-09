import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, ATTACHMENT_PREVIEWS, ATTACHMENT_SIZES, ATTACHMENT_FITS, HTML_VIEW_POLICY, fileHeaders, viewHtml, FRAME_HEIGHT_SCRIPT, FRAME_LINK_BASE, frameStorageScript } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

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
  for (const [name, mime, bytes] of [['a.png', 'image/png', PNG], ['a.pdf', 'application/pdf', Buffer.from('%PDF-1.4')], ['a.bin', undefined, HTML]]) {
    assert.deepEqual(fileHeaders({ name, mime }, bytes, { view: true }), fileHeaders({ name, mime }, bytes), `${name}: ?view is ignored for a non-HTML file`);
  }
});

test('viewHtml puts the frame script after the doctype, so the page keeps standards mode, and touches no other byte (Issue #1175)', () => {
  const script = Buffer.from(FRAME_HEIGHT_SCRIPT);
  const cases = [
    ['<!doctype html><p>x</p>', '<!doctype html>', '<p>x</p>'],
    ['﻿  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN">\n<html><body>é</body></html>', '﻿  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN">', '\n<html><body>é</body></html>'],
    ['<html><body>no doctype</body></html>', '', '<html><body>no doctype</body></html>'],
  ];
  for (const [page, before, after] of cases) {
    assert.deepEqual(viewHtml(Buffer.from(page)), Buffer.concat([Buffer.from(before), script, Buffer.from(after)]), page.slice(0, 20));
  }
  const latin = Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
  assert.deepEqual(viewHtml(latin).subarray(script.length), latin, 'bytes that are not UTF-8 pass through untouched');
  assert.match(FRAME_HEIGHT_SCRIPT, /^<script>[^<]*<\/script>$/, 'one inline script, allowed by script-src unsafe-inline');
  assert.match(FRAME_HEIGHT_SCRIPT, /parent\.postMessage\(\{ ?weave: ?'frame-height'/, 'it posts the height to the parent');
  assert.doesNotMatch(FRAME_HEIGHT_SCRIPT, /fetch|XMLHttpRequest|cookie/, 'it reaches nothing but the parent');
});

test('GET /api/files/:id?view serves the HTML upload in place; the bare route still downloads it', async () => {
  const w = fresh();
  const e = w.createEntity('Issue', { name: 'Page' });
  const file = w.attachFile(e.id, { name: 'page.html', mime: 'text/html', bytes: HTML });
  await withServer(w, async ({ base }) => {
    const bare = await fetch(`${base}/api/files/${file.id}`);
    assert.equal(bare.headers.get('content-type'), 'application/octet-stream');
    const shown = await fetch(`${base}/api/files/${file.id}?view`);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(shown.headers.get('content-security-policy'), `${HTML_VIEW_POLICY}; frame-ancestors 'self'`, 'the view policy, plus the frame rule every HTML answer carries');
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), viewHtml(HTML, FRAME_LINK_BASE + frameStorageScript({}) + FRAME_HEIGHT_SCRIPT), 'the page, with the link base and the storage and height scripts after its doctype');
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/files/${file.id}`)).arrayBuffer()), HTML, 'the stored bytes are unchanged');
    const png = w.attachFile(e.id, { name: 'a.png', mime: 'image/png', bytes: PNG });
    assert.equal((await fetch(`${base}/api/files/${png.id}?view`)).headers.get('content-security-policy'), "sandbox; default-src 'none'");
  });
});

test('GET /api/files/:id?view opens the page\'s links in a new tab through an injected <base target="_blank">, unless the page sets its own <base> (Issue #1475)', async () => {
  const w = fresh();
  const e = w.createEntity('Issue', { name: 'Page' });
  const plain = w.attachFile(e.id, { name: 'plain.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><a href="https://elsewhere.test/">away</a>') });
  const own = w.attachFile(e.id, { name: 'own.html', mime: 'text/html', bytes: Buffer.from('<!doctype html><html><head><BASE href="https://elsewhere.test/"></head><a href="x">x</a></html>') });
  await withServer(w, async ({ base }) => {
    const shown = await (await fetch(`${base}/api/files/${plain.id}?view`)).text();
    assert.ok(shown.startsWith('<!doctype html><base target="_blank"><script>'), 'the base comes first after the doctype, so it wins over any later one');
    assert.equal(shown.match(/<base\b/gi).length, 1, 'one base');
    assert.match(shown, /addEventListener\('click'/, 'with the script that keeps in-page anchors in place');
    assert.ok(shown.endsWith(FRAME_HEIGHT_SCRIPT + '<a href="https://elsewhere.test/">away</a>'), 'the page itself is untouched');
    const kept = await (await fetch(`${base}/api/files/${own.id}?view`)).text();
    assert.doesNotMatch(kept, /target="_blank"/, 'a page with its own base keeps its own link behaviour');
    assert.equal(kept.match(/<base\b/gi).length, 1, 'only the page\'s own base');
  });
});

test('fileHeaders serves an AVIF upload inline as image/avif, so a board cover and an img can draw it (Issue #1212)', () => {
  const avif = Buffer.concat([Buffer.from('0000001c6674797061766966000000006176696600000000', 'hex'), Buffer.alloc(64)]);
  const avis = Buffer.concat([Buffer.from('0000001c6674797061766973000000006176697300000000', 'hex'), Buffer.alloc(64)]);
  for (const bytes of [avif, avis]) {
    const h = fileHeaders({ name: 'pillows.avif', mime: 'image/avif' }, bytes);
    assert.equal(h['Content-Type'], 'image/avif');
    assert.match(h['Content-Disposition'], /^inline;/);
  }
  const lying = fileHeaders({ name: 'x.avif', mime: 'image/avif' }, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.equal(lying['Content-Type'], 'application/octet-stream', 'bytes that are no AVIF still download');
});
