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
  assert.match(renderMarkdown('```mmd\npie\n```'), /class="mermaid"/);
});

test('weaver seed: docs, wiki, quality mirror, issues + roadmap', () => {
  const w = seedWeaver(new Weave());
  assert.equal(w.state.meta.name, 'weave');
  const spaces = w.listSpaces().filter((s) => !s.system).map((s) => s.name).sort();
  assert.deepEqual(spaces, ['Development', 'Handbook', 'Quality', 'Showcase', 'Wiki']);

  const suites = w.query('Suite', { where: [['Name', '=', 'Engine']] });
  assert.ok(suites.items[0].fields['Case Count'] >= 17, 'the Engine suite mirror is populated');

  const shipped = w.query('Feature', { where: [['Status', '=', 'Shipped']] });
  assert.ok(shipped.total >= 10);
  const open = w.query('Issue', { where: [['Status', '=', 'Open']] });
  assert.ok(open.total >= 3);

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
    const list = await (await fetch(`${base}/api/workspaces`)).json();
    assert.deepEqual(list.map((w) => w.name).sort(), ['uno', 'weave']);
    assert.ok(list.find((w) => w.name === 'uno').default);

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.workspace, 'uno');

    const wHealth = await (await fetch(`${base}/w/weave/api/health`)).json();
    assert.equal(wHealth.workspace, 'weave');
    const guides = await (await fetch(`${base}/w/weave/api/tables/Guide/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    assert.ok(guides.total >= 4);

    const guideId = guides.items[0].id;
    const docHtml = await (await fetch(`${base}/w/weave/e/${guideId}/doc.html`)).text();
    assert.match(docHtml, /<h1>/);
    const permalink = await fetch(`${base}/w/weave/e/${guideId}`, { redirect: 'manual' });
    assert.equal(permalink.status, 200);
    assert.match(await permalink.text(), new RegExp(`<meta name="weave-route" content="/w/weave/#/entity/${guideId}">`));

    assert.equal((await fetch(`${base}/w/nope/api/health`)).status, 404);

    const scoped = await (await fetch(`${base}/w/weave/api/search?q=quickstart`)).json();
    assert.ok(scoped.some((h) => h.url.startsWith('/w/weave/')));

    const all = await (await fetch(`${base}/api/search?q=uno+thing&all=1`)).json();
    assert.ok(all.some((h) => h.workspace === 'uno' && h.kind === 'entity'));
    const allDocs = await (await fetch(`${base}/api/search?q=zero&all=1`)).json();
    assert.ok(allDocs.some((h) => h.workspace === 'weave'));

    const page = await (await fetch(`${base}/w/weave/`)).text();
    assert.match(page, /id="app"/);
    assert.match(page, /<title>weave<\/title>/, 'the shell wears the workspace title before the app runs (Feature #264)');

    const mmd = await fetch(`${base}/w/weave/e/${guideId}/doc.mmd`);
    assert.equal(mmd.headers.get('content-type'), 'text/vnd.mermaid; charset=utf-8');
  } finally {
    server.close();
  }
});

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
      const meta = await (await fetch(`${base}/w/${scratch.id}/api/workspace`)).json();
      assert.equal(meta.description ?? '', '', 'a fresh workspace starts with no description');
      assert.equal(scratch.tables, 0, 'a fresh member counts no tables');
      assert.equal(list.find((w) => w.name === 'main').tables, 0, 'nor does the root, registry and all');

      const gone = await fetch(`${base}/api/workspaces/${scratch.id}`, { method: 'DELETE' });
      assert.equal(gone.status, 200);
      const after = await (await fetch(`${base}/api/workspaces`)).json();
      assert.ok(!after.some((w) => w.name === 'scratch'), 'delisted');
      assert.ok(readdirSync(dir).includes('scratch.db'), 'soft delete leaves the file in place');
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
