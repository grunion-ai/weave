import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { renderMarkdown } from '../src/markdown.js';

test('engine refuses to adopt non-workspace JSON files', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'weave-guard-'));
  try {
    const pkg = join(dir, 'package.json');
    const original = '{\n "name": "something",\n "version": "1.0.0"\n}';
    writeFileSync(pkg, original);
    assert.throws(() => new Weave({ path: pkg }), /not a Weave workspace/);
    assert.equal(readFileSync(pkg, 'utf8'), original, 'file must be untouched');

    // The hub scan must skip it silently and not corrupt it.
    const w = new Weave({ path: join(dir, 'main.json') });
    w.state.meta.name = 'main';
    w.createSpace({ name: 'S' });
    const { server } = await startServer(w, { port: 0 });
    try {
      const list = await (await fetch(`http://127.0.0.1:${server.address().port}/api/workspaces`)).json();
      assert.deepEqual(list.map((x) => x.name), ['main']);
      assert.equal(readFileSync(pkg, 'utf8'), original, 'scan must not touch non-workspace JSON');
    } finally {
      server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markdown: mermaid fences and raw HTML blocks', () => {
  const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```\n\n<div class="callout">raw <b>html</b></div>\n\nplain');
  assert.match(html, /<pre class="mermaid">graph TD; A--&gt;B;<\/pre>/);
  assert.match(html, /<div class="callout">raw <b>html<\/b><\/div>/);
  assert.match(html, /<p>plain<\/p>/);
  // ```mmd works too
  assert.match(renderMarkdown('```mmd\npie\n```'), /class="mermaid"/);
});

test('weaver seed: docs, wiki, quality mirror, issues + roadmap', () => {
  const w = seedWeaver(new Weave());
  assert.equal(w.state.meta.name, 'weave');
  const spaces = w.listSpaces().filter((s) => !s.system).map((s) => s.name).sort();
  assert.deepEqual(spaces, ['Development', 'Handbook', 'Quality', 'Showcase', 'Wiki']);

  // Quality mirrors the real test suites — generated from the files, so the
  // count is whatever engine.test.mjs actually declares today.
  const suites = w.query('Suite', { where: [['Name', '=', 'Engine']] });
  assert.ok(suites.items[0].fields['Case Count'] >= 17, 'the Engine suite mirror is populated');

  // Roadmap has shipped and planned features; issues carry severity.
  const shipped = w.query('Feature', { where: [['Status', '=', 'Shipped']] });
  assert.ok(shipped.total >= 10);
  const open = w.query('Issue', { where: [['Status', '=', 'Open']] });
  assert.ok(open.total >= 3);

  // Docs are searchable.
  assert.ok(w.search('quickstart').length >= 1);
});

test('multi-workspace hub: scoped routing, listing, cross-workspace search', async () => {
  const uno = new Weave();
  uno.state.meta.name = 'uno';
  uno.createSpace({ name: 'Main' });
  const items = uno.createTable({ space: 'Main', name: 'Item' });
  uno.createEntity(items, { name: 'Uno thing' });

  const weave = seedWeaver(new Weave());

  const { server } = await startServer(uno, { port: 0, workspaces: { weave } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Workspace list
    const list = await (await fetch(`${base}/api/workspaces`)).json();
    assert.deepEqual(list.map((w) => w.name).sort(), ['uno', 'weave']);
    assert.ok(list.find((w) => w.name === 'uno').default);

    // Unscoped API hits the default workspace
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.workspace, 'uno');

    // Scoped API hits the sibling
    const wHealth = await (await fetch(`${base}/w/weave/api/health`)).json();
    assert.equal(wHealth.workspace, 'weave');
    const guides = await (await fetch(`${base}/w/weave/api/tables/Guide/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    assert.ok(guides.total >= 4);

    // Scoped doc rendering + redirect carry the prefix
    const guideId = guides.items[0].id;
    const docHtml = await (await fetch(`${base}/w/weave/e/${guideId}/doc.html`)).text();
    assert.match(docHtml, /<h1>/);
    const redirect = await fetch(`${base}/w/weave/e/${guideId}`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get('location'), /^\/w\/weave\/#\/entity\//);

    // Unknown workspace 404s
    assert.equal((await fetch(`${base}/w/nope/api/health`)).status, 404);

    // Scoped search prefixes permalinks
    const scoped = await (await fetch(`${base}/w/weave/api/search?q=quickstart`)).json();
    assert.ok(scoped.some((h) => h.url.startsWith('/w/weave/')));

    // Cross-workspace search finds results from both, tagged by workspace
    const all = await (await fetch(`${base}/api/search?q=uno+thing&all=1`)).json();
    assert.ok(all.some((h) => h.workspace === 'uno' && h.kind === 'entity'));
    const allDocs = await (await fetch(`${base}/api/search?q=zero&all=1`)).json();
    assert.ok(allDocs.some((h) => h.workspace === 'weave'));

    // Static UI served under the workspace path too
    const page = await (await fetch(`${base}/w/weave/`)).text();
    assert.match(page, /<title>Weave<\/title>/);

    // .mmd document format
    const mmd = await fetch(`${base}/w/weave/e/${guideId}/doc.mmd`);
    assert.equal(mmd.headers.get('content-type'), 'text/vnd.mermaid; charset=utf-8');
  } finally {
    server.close();
  }
});

/* Issue #122 — a workspace can be removed: the hub moves its .db to trash/
   (recoverable, invisible to scan), and the default + weave docs workspaces
   refuse. Issue #123 rides along: a hub-created workspace opens with a
   description that says what to do first. */
test('workspace delete: trash move, guards, and the fresh-workspace description', async () => {
  const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Weave } = await import('../src/engine.js');
  const { startServer } = await import('../src/server.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-wsdel-'));
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.state.meta.name = 'main';
    main.save();
    const { server } = await startServer(main, {});
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const made = await (await fetch(`${base}/api/workspaces`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'scratch' }),
      })).json();
      assert.equal(made.name, 'scratch');
      const list = await (await fetch(`${base}/api/workspaces`)).json();
      const scratch = list.find((w) => w.name === 'scratch');
      assert.ok(scratch, 'created and listed');
      // Issue #123: the newcomer is told what they are looking at.
      const meta = await (await fetch(`${base}/w/${scratch.id}/api/workspace`)).json();
      assert.match(meta.description ?? '', /space/i, 'a fresh workspace explains itself');

      // Soft by default (lifecycle gate): a tombstone, the file stays put.
      const gone = await fetch(`${base}/api/workspaces/${scratch.id}`, { method: 'DELETE' });
      assert.equal(gone.status, 200);
      const after = await (await fetch(`${base}/api/workspaces`)).json();
      assert.ok(!after.some((w) => w.name === 'scratch'), 'delisted');
      assert.ok(readdirSync(dir).includes('scratch.db'), 'soft delete leaves the file in place');
      // ?hard=1 is the Issue #122 move: the .db leaves the data dir for trash/.
      const purged = await fetch(`${base}/api/workspaces/${scratch.id}?hard=1`, { method: 'DELETE' });
      assert.equal(purged.status, 200);
      assert.ok(!readdirSync(dir).includes('scratch.db'), 'file left the data dir');
      assert.ok(readdirSync(join(dir, 'trash')).some((f) => f.startsWith('scratch-')), 'and landed in trash/');

      const noDefault = await fetch(`${base}/api/workspaces/main`, { method: 'DELETE' });
      assert.equal(noDefault.status, 400, 'the default workspace stays');
    } finally {
      server.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
