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

  // Quality mirrors the real test suites with rollup counts.
  const suites = w.query('Suite', { where: [['Name', '=', 'Engine']] });
  assert.equal(suites.items[0].fields['Case Count'], 17);

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
