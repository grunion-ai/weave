import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-docbox-')), 'keystore.json');
const { Weave, HTML_VIEW_POLICY } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');

const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox;';
const FRAGMENT = '<script>fetch("/api/tables")</script>\n<img src=x onerror="fetch(\'/api/accounts\')">';

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'Docs' });
  const db = w.createTable({ space: 'Docs', name: 'Note' });
  const page = w.createEntity(db.id, { name: 'Page' });
  const app = w.createEntity(db.id, { name: 'App' });
  w.setDoc(page.id, `# Page\n\n${FRAGMENT}\n`);
  w.setDoc(app.id, `<!doctype html><html><body>${FRAGMENT}</body></html>`);
  const share = w.mintShare({ scope: { kind: 'table', id: db.id } });
  return { w, db, page, app, share };
}

const sandboxed = (res, label) => {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.startsWith(SANDBOX), `${label}: answers under the sandbox: ${csp}`);
  assert.doesNotMatch(csp, /allow-same-origin/, `${label}: never shares the workspace origin`);
  assert.match(csp, /default-src 'none'/, `${label}: loads nothing it was not granted`);
  assert.doesNotMatch(csp, /connect-src/, `${label}: no fetch, XHR or socket`);
  return csp;
};

test('every page that carries document HTML answers under the sandbox policy', async () => {
  const { w, db, page, app, share } = seed();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const stored = await fetch(`${base}/e/${app.id}/doc.html`);
    assert.equal(stored.status, 200);
    assert.equal(sandboxed(stored, 'html document'), `${HTML_VIEW_POLICY}; frame-ancestors 'self'`, 'an html document wears the attachment view policy');
    for (const [label, path] of [
      ['doc.html', `/e/${page.id}/doc.html`],
      ['entity.html', `/e/${page.id}/entity.html`],
      ['share table page', `/s/${share.token}/table/${db.id}`],
      ['share doc.html', `/s/${share.token}/e/${page.id}/doc.html`],
      ['share entity.html', `/s/${share.token}/e/${page.id}/entity.html`],
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, label);
      assert.match(res.headers.get('content-type'), /^text\/html/, label);
      const csp = sandboxed(res, label);
      assert.match(csp, /frame-ancestors 'self'/, `${label}: keeps the frame rule`);
    }
  } finally { server.close(); }
});

test('the doc frame for an html document is sandboxed like an HTML attachment frame', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const frame = app.match(/el\('iframe', \{ class: 'doc-app'[^}]*\}/);
  assert.ok(frame, 'the doc frame is built in app.js');
  assert.match(frame[0], /sandbox: HTML_FRAME_SANDBOX/, `the doc frame carries the attachment sandbox: ${frame[0]}`);
});

test('POST /api/markdown escapes HTML blocks, at the top level and inside a quote', async () => {
  const { w } = seed();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const md of [FRAGMENT, `> ${FRAGMENT.replace('\n', '\n> ')}`, `Intro\n\n${FRAGMENT}\n\n**after**`]) {
      const res = await fetch(`${base}/api/markdown`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md }),
      });
      assert.equal(res.status, 200);
      const { html } = await res.json();
      assert.doesNotMatch(html, /<script/i, `no script element: ${html}`);
      assert.doesNotMatch(html, /<img/i, `no element carrying a handler: ${html}`);
      assert.match(html, /&lt;script&gt;/, 'the fragment shows as text');
      assert.match(html, /onerror=/, 'the attribute text stays readable');
    }
    const plain = await fetch(`${base}/api/markdown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: '## Plan\n\n- **call** the vendor' }),
    }).then((r) => r.json());
    assert.match(plain.html, /<h2>Plan<\/h2>/, 'markdown still renders');
    assert.match(plain.html, /<strong>call<\/strong>/);
  } finally { server.close(); }
});

test('the task applet returns its description with HTML blocks escaped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-docbox-applet-'));
  const w = new Weave({ path: join(dir, 'uno.json') });
  w.state.meta.name = 'uno';
  const space = w.createSpace({ name: 'Product' });
  const db = w.createTable({ space: space.id, name: 'Task' });
  w.addField(db.id, { name: 'State', type: 'workflow', config: { states: [{ id: 'open', name: 'Open', category: 'not-started', default: true }] } });
  const task = w.createEntity(db.id, { Name: 'Call the vendor', State: 'Open' });
  w.setDoc(task.id, `## Plan\n\n${FRAGMENT}\n`);
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = '11243947';
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unlocked = await fetch(`${base}/t/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: '11243947' }),
    });
    const cookie = (unlocked.headers.get('set-cookie') ?? '').split(';')[0];
    assert.ok(cookie, 'the applet unlocks');
    const read = await (await fetch(`${base}/t/entity/${task.id}`, { headers: { cookie } })).json();
    const wrote = await (await fetch(`${base}/t/entity/${task.id}/doc`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ doc: `## Plan\n\n${FRAGMENT}\n` }),
    })).json();
    for (const [label, html] of [['read', read.docHtml], ['write', wrote.docHtml]]) {
      assert.match(html, /<h2/, `${label}: markdown still renders`);
      assert.doesNotMatch(html, /<script|<img/i, `${label}: no live markup: ${html}`);
      assert.match(html, /&lt;script&gt;/, `${label}: the fragment shows as text`);
    }
  } finally {
    server.close();
    if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
    else process.env.WEAVE_APPLET_PASSCODE = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the rendered page keeps raw HTML blocks; only the sandbox contains them', async () => {
  const { renderMarkdown } = await import('../../src/markdown.js');
  assert.match(renderMarkdown('<div class="pagebreak"></div>'), /<div class="pagebreak"><\/div>/, 'the default render is unchanged');
  assert.doesNotMatch(renderMarkdown('<div class="pagebreak"></div>', { rawHtml: false }), /<div/);
});
