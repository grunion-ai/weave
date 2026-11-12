import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE ??= join(tempDir('weave-csp-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');

const TOKEN = 'csp-count-reader-token-0123456789abcdef';
const APP_PAGES = ['/', '/auth', '/does-not-exist'];
const THIRD_PARTY_FRAMES = ['https://challenges.cloudflare.com', 'https://*.protect.clerk.com', 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com'];

const policy = (header) => Object.fromEntries(String(header ?? '').split(';').map((d) => d.trim()).filter(Boolean)
  .map((d) => { const [name, ...sources] = d.split(/\s+/); return [name, sources]; }));

async function stand(options = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Docs' });
  const db = w.createTable({ space: 'Docs', name: 'Note' });
  const note = w.createEntity(db.id, { Name: 'Page' });
  w.setDoc(note.id, '# Page\n\nhello');
  const { server, port } = await startServer(w, { port: 0, deployToken: TOKEN, ...options });
  return { base: `http://127.0.0.1:${port}`, note, stop: () => server.close() };
}

const report = (base, body, headers = {}) => fetch(`${base}/csp-report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/csp-report', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const violation = (fields) => ({ 'csp-report': { 'document-uri': 'http://127.0.0.1/', 'blocked-uri': 'https://elsewhere.example/', ...fields } });
const counts = async (base) => (await fetch(`${base}/_supervisor/csp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();

test('app pages enforce frame-src, object-src, base-uri and form-action and send each violation to the sink', async () => {
  const { base, stop } = await stand();
  try {
    for (const path of APP_PAGES) {
      const res = await fetch(`${base}${path}`);
      assert.match(res.headers.get('content-type'), /^text\/html/, path);
      const enforced = policy(res.headers.get('content-security-policy'));
      assert.deepEqual(enforced['object-src'], ["'none'"], path);
      assert.deepEqual(enforced['base-uri'], ["'self'"], path);
      assert.deepEqual(enforced['form-action'], ["'self'"], path);
      assert.equal(enforced['frame-src']?.[0], "'self'", `${path}: weave frames its own pages`);
      assert.deepEqual(enforced['frame-ancestors'], ["'self'"], path);
      assert.deepEqual(enforced['report-uri'], ['/csp-report'], path);
      for (const d of ['default-src', 'script-src', 'style-src', 'connect-src']) assert.equal(enforced[d], undefined, `${path}: ${d} is not enforced yet`);
    }
  } finally { stop(); }
});

test("the enforced frame-src still lets Clerk's bot check and Stripe checkout frame in", async () => {
  const { base, stop } = await stand();
  try {
    const frames = policy((await fetch(`${base}/`)).headers.get('content-security-policy'))['frame-src'];
    assert.deepEqual(frames, ["'self'", ...THIRD_PARTY_FRAMES]);
  } finally { stop(); }
});

test('the report-only header keeps the rest of the policy and reports to the same sink', async () => {
  const { base, stop } = await stand();
  try {
    for (const path of APP_PAGES) {
      const res = await fetch(`${base}${path}`);
      const enforced = policy(res.headers.get('content-security-policy'));
      const reported = policy(res.headers.get('content-security-policy-report-only'));
      assert.deepEqual(reported['default-src'], ["'self'"], path);
      assert.deepEqual(reported['script-src'], ["'self'"], path);
      assert.deepEqual(reported['style-src'], ["'self'"], path);
      assert.deepEqual(reported['connect-src'], ["'self'"], path);
      for (const d of ['img-src', 'font-src', 'worker-src']) assert.ok(reported[d], `${path}: ${d} is still reported`);
      for (const d of ['frame-src', 'object-src', 'base-uri', 'form-action']) assert.deepEqual(reported[d], enforced[d], `${path}: ${d} reads the same in both, so a frame the enforced policy allows is not reported`);
      assert.equal(reported['frame-ancestors'], undefined, `${path}: frame-ancestors is enforced with WEAVE_FRAME_ANCESTORS, so the report-only copy is gone`);
      assert.deepEqual(reported['report-uri'], ['/csp-report'], path);
    }
  } finally { stop(); }
});

test('a page that brings its own sandbox policy keeps it and sends no reports', async () => {
  const { base, note, stop } = await stand();
  try {
    const res = await fetch(`${base}/e/${note.id}/doc.html`);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /^sandbox /);
    assert.match(csp, /; frame-ancestors 'self'$/);
    assert.doesNotMatch(csp, /report-uri/);
    assert.equal(res.headers.get('content-security-policy-report-only'), null);
  } finally { stop(); }
});

test('a report POST increments the count for its directive, apart for blocked and reported', async () => {
  const { base, stop } = await stand();
  try {
    const empty = await counts(base);
    assert.deepEqual([empty.blocked, empty.reported], [{}, {}]);
    const first = await report(base, violation({ 'effective-directive': 'frame-src', 'violated-directive': 'frame-src', disposition: 'enforce' }));
    assert.equal(first.status, 204);
    assert.equal(await first.text(), '');
    await report(base, violation({ 'effective-directive': 'script-src-elem', disposition: 'report' }));
    await report(base, violation({ 'effective-directive': 'script-src-elem', disposition: 'report' }));
    await report(base, violation({ 'violated-directive': "style-src 'self'" }), { 'Content-Type': 'application/json' });
    const after = await counts(base);
    assert.deepEqual(after.blocked, { 'frame-src': 1 });
    assert.deepEqual(after.reported, { 'script-src-elem': 2, 'style-src': 1 });
    assert.ok(Date.parse(after.since) <= Date.now(), 'the count says when it started');
  } finally { stop(); }
});

test('a report the sink cannot read is refused and leaves the count alone', async () => {
  const { base, stop } = await stand();
  try {
    assert.equal((await report(base, '{not json')).status, 400);
    assert.equal((await report(base, { other: { 'effective-directive': 'frame-src' } })).status, 400);
    assert.equal((await report(base, violation({ 'effective-directive': 'frame-src', 'script-sample': 'x'.repeat(20000) }))).status, 413);
    assert.equal((await report(base, violation({ 'effective-directive': 'frame-src' }), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await fetch(`${base}/csp-report`)).status, 405);
    const untouched = await counts(base);
    assert.deepEqual([untouched.blocked, untouched.reported], [{}, {}]);
  } finally { stop(); }
});

test('a directive name the sink does not know counts as other, so the count stays bounded', async () => {
  const { base, stop } = await stand();
  try {
    for (let i = 0; i < 50; i++) await report(base, violation({ 'effective-directive': `made-up-${i}`, disposition: 'enforce' }));
    await report(base, violation({ 'effective-directive': ['frame-src'], disposition: 'enforce' }));
    const c = await counts(base);
    assert.deepEqual(c.blocked, { other: 51 });
  } finally { stop(); }
});

test('the count answers only to the deploy token', async () => {
  const { base, stop } = await stand();
  try {
    assert.equal((await fetch(`${base}/_supervisor/csp`)).status, 401);
    assert.equal((await fetch(`${base}/_supervisor/csp`, { headers: { Authorization: `Bearer ${'x'.repeat(40)}` } })).status, 401);
    assert.equal((await fetch(`${base}/_supervisor/csp`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405);
    const res = await fetch(`${base}/_supervisor/csp`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally { stop(); }
  const open = await stand({ deployToken: null });
  try {
    await report(open.base, violation({ 'effective-directive': 'frame-src', disposition: 'enforce' }));
    const res = await fetch(`${open.base}/_supervisor/csp`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /json/, 'without a deploy token there is no count to read');
  } finally { open.stop(); }
});
