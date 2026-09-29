/* The workspace logo's type comes from its bytes (Issue #492).
   PUT /api/workspace/logo stored whatever content type the writer named and
   GET served it back, so a writer could plant an HTML page at the logo URL
   that ran script on the workspace origin. Upload now takes PNG, JPEG, GIF,
   WebP and SVG (the logo picker offers image/* and the chip draws it through
   an <img>), decided from the leading bytes, and refuses anything else with
   415. The logo is served with the type its bytes prove, nosniff and a
   sandbox policy, so an SVG opened on its own runs no script. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'weave-logo-type-'));
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const GIF = Buffer.from('474946383961010001000000002c00000000010001000002', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('﻿<?xml version="1.0"?>\n<!-- mark -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
const HTML = Buffer.from('<!doctype html><script>document.title="pwned"</script>');
const ICO = Buffer.from('0000010001001010', 'hex');
const SANDBOX = "sandbox; default-src 'none'";

async function stand(w = new Weave()) {
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (name, mime, bytes) => fetch(`${base}/api/workspace/logo`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mime, contentBase64: bytes.toString('base64') }),
  });
  return { w, base, put, stop: () => server.close() };
}

test('a logo that is not a PNG, JPEG, GIF, WebP or SVG is refused with 415', async () => {
  const s = await stand();
  try {
    for (const [name, mime, bytes] of [
      ['x.html', 'text/html', HTML],
      ['x.png', 'image/png', HTML],
      ['x.svg', 'image/svg+xml', HTML],
      ['x.ico', 'image/x-icon', ICO],
    ]) {
      const res = await s.put(name, mime, bytes);
      assert.equal(res.status, 415, `${name} as ${mime}`);
      assert.equal(s.w.state.meta.logo, undefined, 'nothing was stored');
    }
  } finally { s.stop(); }
});

test('an accepted logo is served with the type its bytes prove, nosniff and sandbox', async () => {
  const s = await stand();
  try {
    for (const [name, claimed, bytes, type] of [
      ['a.png', 'text/html', PNG, 'image/png'],
      ['a.jpg', 'image/jpeg', JPEG, 'image/jpeg'],
      ['a.gif', 'image/gif', GIF, 'image/gif'],
      ['a.webp', 'image/webp', WEBP, 'image/webp'],
      ['a.svg', 'text/html', SVG, 'image/svg+xml'],
    ]) {
      assert.equal((await s.put(name, claimed, bytes)).status, 200, name);
      const got = await fetch(`${s.base}/api/workspace/logo`);
      assert.equal(got.status, 200);
      assert.equal(got.headers.get('content-type'), type, `${name}: type`);
      assert.equal(got.headers.get('x-content-type-options'), 'nosniff', `${name}: nosniff`);
      assert.equal(got.headers.get('content-security-policy'), SANDBOX, `${name}: sandbox`);
      assert.deepEqual(Buffer.from(await got.arrayBuffer()), bytes);
    }
  } finally { s.stop(); }
});

test('a logo stored before the fix with a hostile type is served as a download', async () => {
  const w = new Weave();
  w.setWorkspaceLogo({ name: 'a.png', mime: 'image/png', bytes: PNG });
  w.state.meta.logo.mime = 'text/html';
  w.state.fileBlobs[w.state.meta.logo.id] = HTML.toString('base64');
  const s = await stand(w);
  try {
    const got = await fetch(`${s.base}/api/workspace/logo`);
    assert.equal(got.headers.get('content-type'), 'application/octet-stream');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(got.headers.get('content-security-policy'), SANDBOX);
  } finally { s.stop(); }
});
