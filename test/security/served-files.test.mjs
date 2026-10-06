import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'weave-served-'));
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const GIF = Buffer.from('474946383961010001000000002c00000000010001000002', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const HTML = Buffer.from('<!doctype html><script>document.title="pwned"</script>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SANDBOX = "sandbox; default-src 'none'";

async function stand() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const db = w.createTable({ space: 'S', name: 'Item' });
  const e = w.createEntity(db, { name: 'E' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = async (name, mime, bytes) => {
    const res = await fetch(`${base}/api/entities/${e.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mime, contentBase64: Buffer.from(bytes).toString('base64') }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).id;
  };
  return { base, upload, stop: () => server.close() };
}

function assertInert(res, label) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);
  assert.equal(res.headers.get('content-security-policy'), SANDBOX, `${label}: sandbox policy`);
}

test('an uploaded HTML or SVG file downloads as octet-stream, never renders', async () => {
  const s = await stand();
  try {
    for (const [name, mime, bytes] of [
      ['x.html', 'text/html', HTML],
      ['x.svg', 'image/svg+xml', SVG],
      ['x.xml', 'application/xhtml+xml', HTML],
      ['x.html', 'TEXT/HTML; charset=utf-8', HTML],
      ['x.bin', undefined, HTML],
    ]) {
      const res = await fetch(`${s.base}/api/files/${await s.upload(name, mime, bytes)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream', `${mime}: type`);
      assert.match(res.headers.get('content-disposition'), /^attachment;/, `${mime}: attachment`);
      assertInert(res, mime);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes, 'the bytes are unchanged');
    }
  } finally { s.stop(); }
});

test('a file that claims an image type but is not one downloads', async () => {
  const s = await stand();
  try {
    const res = await fetch(`${s.base}/api/files/${await s.upload('x.png', 'image/png', HTML)}`);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('content-disposition'), /^attachment;/);
    assertInert(res, 'fake png');
  } finally { s.stop(); }
});

test('images, PDFs and plain text still open in place under the new headers', async () => {
  const s = await stand();
  try {
    for (const [name, mime, bytes] of [
      ['a.png', 'image/png', PNG],
      ['a.jpg', 'image/jpeg', JPEG],
      ['a.gif', 'image/gif', GIF],
      ['a.webp', 'image/webp', WEBP],
      ['a.pdf', 'application/pdf', Buffer.from('%PDF-1.4 body')],
      ['a.txt', 'text/plain', Buffer.from('file body')],
    ]) {
      const res = await fetch(`${s.base}/api/files/${await s.upload(name, mime, bytes)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), mime, `${name}: type`);
      assert.match(res.headers.get('content-disposition'), /^inline;/, `${name}: inline`);
      assertInert(res, name);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    }
  } finally { s.stop(); }
});

test('a hostile file name cannot break out of the disposition header', async () => {
  const s = await stand();
  try {
    const name = 'a"; filename=evil.htmlé.html';
    const res = await fetch(`${s.base}/api/files/${await s.upload(name, 'text/html', HTML)}`);
    const cd = res.headers.get('content-disposition');
    assert.equal((cd.match(/filename=/g) ?? []).length, 1, cd);
    assert.match(cd, /^attachment; filename="[\w.-]+"; filename\*=UTF-8''[\w.%-]+$/, cd);
    assert.equal(decodeURIComponent(cd.split("''")[1]), name);
  } finally { s.stop(); }
});

test('the task applet serves its files the same way', async () => {
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = '11243947';
  const w = new Weave({ path: join(dir, 'uno.json') });
  w.state.meta.name = 'uno';
  const space = w.createSpace({ name: 'Product' });
  const db = w.createTable({ space: space.id, name: 'Task' });
  const task = w.createEntity(db.id, { Name: 'T' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unlock = await fetch(`${base}/t/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: '11243947' }),
    });
    const cookie = (unlock.headers.get('set-cookie') ?? '').split(';')[0];
    const put = async (name, mime, bytes) => (await (await fetch(`${base}/t/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: task.id, name, mime, contentBase64: bytes.toString('base64') }),
    })).json()).id;
    const html = await fetch(`${base}/t/file/${await put('x.html', 'text/html', HTML)}`, { headers: { cookie } });
    assert.equal(html.headers.get('content-type'), 'application/octet-stream');
    assert.match(html.headers.get('content-disposition'), /^attachment;/);
    assertInert(html, 'applet html');
    const png = await fetch(`${base}/t/file/${await put('a.png', 'image/png', PNG)}`, { headers: { cookie } });
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition'), /^inline;/);
    assertInert(png, 'applet png');
  } finally {
    server.close();
    if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
    else process.env.WEAVE_APPLET_PASSCODE = prior;
  }
});

test('WEAVE_INLINE_FILE_TYPES adds a type served in place, still sandboxed', async () => {
  const s = await stand();
  process.env.WEAVE_INLINE_FILE_TYPES = 'text/csv, audio/mpeg';
  try {
    const res = await fetch(`${s.base}/api/files/${await s.upload('a.csv', 'text/csv', Buffer.from('a,b'))}`);
    assert.equal(res.headers.get('content-type'), 'text/csv');
    assert.match(res.headers.get('content-disposition'), /^inline;/);
    assertInert(res, 'csv');
    const html = await fetch(`${s.base}/api/files/${await s.upload('x.html', 'text/html', HTML)}`);
    assert.equal(html.headers.get('content-type'), 'application/octet-stream', 'html stays a download');
  } finally { delete process.env.WEAVE_INLINE_FILE_TYPES; s.stop(); }
});
