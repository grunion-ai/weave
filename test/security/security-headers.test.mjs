import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer, frameAncestorsFromEnv } = await import('../../src/server.js');
const { launch } = await import('../lib/browser.mjs');

const call = (port, path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
  req.on('error', reject);
  req.end();
});

function seed(w) {
  w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Note' });
  const note = w.createEntity(db.id, { Name: 'Framed' });
  w.setDoc(note.id, '# Framed page\n\nhello from the frame');
  return { note };
}

test('every response carries nosniff and Referrer-Policy; HTML adds frame-ancestors and a report-only policy', async () => {
  const w = new Weave();
  const { note } = seed(w);
  const { server, port } = await startServer(w, { port: 0 });
  try {
    for (const [path, method] of [['/api/workspace'], ['/app.js'], ['/style.css'], ['/nope.png'], ['/api/nope'], ['/api/spaces', 'POST'], ['/%E0%A4%A'], ['/']]) {
      const res = await call(port, path, { 'Content-Type': 'application/json' }, method);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
      assert.equal(res.headers['referrer-policy'], 'same-origin', path);
      assert.equal(res.headers['strict-transport-security'], undefined, `${path}: no HSTS over plain http`);
    }
    for (const path of ['/', `/e/${note.id}/doc.html`, '/auth', '/does-not-exist']) {
      const res = await call(port, path);
      assert.match(res.headers['content-type'], /^text\/html/, path);
      assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self'", path);
      const ro = res.headers['content-security-policy-report-only'];
      assert.match(ro, /default-src 'self'/, path);
      assert.match(ro, /object-src 'none'/, path);
      assert.match(ro, /frame-ancestors 'self'/, path);
    }
    const json = await call(port, '/api/workspace');
    assert.equal(json.headers['content-security-policy'], undefined, 'CSP rides HTML only');
  } finally { server.close(); }
});

test('HSTS only on a request that arrived over https, as WEAVE_TRUST_PROXY reads it', async () => {
  const trusting = await startServer(new Weave(), { port: 0, trustProxy: true });
  const naive = await startServer(new Weave(), { port: 0, trustProxy: false });
  try {
    const https = await call(trusting.port, '/api/health', { 'X-Forwarded-Proto': 'https' });
    assert.equal(https.headers['strict-transport-security'], 'max-age=31536000');
    const http = await call(trusting.port, '/api/health', { 'X-Forwarded-Proto': 'http' });
    assert.equal(http.headers['strict-transport-security'], undefined);
    const spoofed = await call(naive.port, '/api/health', { 'X-Forwarded-Proto': 'https' });
    assert.equal(spoofed.headers['strict-transport-security'], undefined, 'an untrusted header is not https');
  } finally { trusting.server.close(); naive.server.close(); }
});

test('WEAVE_FRAME_ANCESTORS extends frame-ancestors', async () => {
  assert.deepEqual(frameAncestorsFromEnv({ WEAVE_FRAME_ANCESTORS: 'https://demo.example.com, https://b.example' }), ['https://demo.example.com', 'https://b.example']);
  assert.deepEqual(frameAncestorsFromEnv({}), []);
  const { server, port } = await startServer(new Weave(), { port: 0, frameAncestors: ['https://demo.example.com'] });
  try {
    const res = await call(port, '/');
    assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self' https://demo.example.com");
  } finally { server.close(); }
});

const ctx = await launch('security headers: framing', seed);
if (ctx) {
  const { base, browser, note } = ctx;
  const frameText = async (page, src) => {
    await page.evaluate((s) => new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.src = s;
      f.onload = resolve;
      document.body.append(f);
    }), src);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    return frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  };

  test("weave's own pages still frame same-origin pages", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${note.id}/doc.html`);
      assert.match(await frameText(page, `/e/${note.id}/doc.html`), /hello from the frame/);
    } finally { await page.close(); }
  });

  test('another origin cannot frame a weave page', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base.replace('127.0.0.1', 'localhost')}/e/${note.id}/doc.html`);
      assert.doesNotMatch(await frameText(page, `${base}/e/${note.id}/doc.html`), /hello from the frame/);
    } finally { await page.close(); }
  });
}
