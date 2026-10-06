import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { renderMarkdown } from '../src/markdown.js';

function buildWorkspace() {
  const w = new Weave();
  w.state.meta.name = 'demo';
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  const t = w.createEntity(tasks, { name: 'Ship it' });
  return { w, tasks, t };
}

async function withServer(w, body, { workspaces = {} } = {}) {
  const { server } = await startServer(w, { port: 0, workspaces });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await body({
      base,
      render: async (md, prefix = '') => {
        const res = await fetch(`${base}${prefix}/api/markdown`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md }),
        });
        assert.equal(res.status, 200, 'rendering markdown must never fail');
        return (await res.json()).html;
      },
      get: async (path) => {
        const res = await fetch(base + path);
        return { status: res.status, text: await res.text() };
      },
    });
  } finally {
    server.close();
  }
}

const chips = (html) =>
  [...html.matchAll(/<a class="(mention mention-\w+)" href="([^"]+)"(?: data-name="[^"]*")?>([^<]*)<\/a>/g)]
    .map((m) => [m[1], m[2], m[3]]);

function recordingResolver(calls = []) {
  const fn = (kind, ref) => {
    calls.push([kind, ref]);
    return { href: `/x/${kind}/${ref}`, label: `${kind}:${ref}` };
  };
  fn.calls = calls;
  return fn;
}

test('the resolver is called with a kind and a reference', () => {
  const r = recordingResolver();
  renderMarkdown('[[Task#1]] [[table:Product/Task]] [[space:Product]] [[workspace]]', { resolveMention: r });
  assert.deepEqual(r.calls, [
    ['entity', 'Task#1'],
    ['table', 'Product/Task'],
    ['space', 'Product'],
    ['workspace', ''],
  ]);
});

test('each kind renders as a mention link carrying its kind', () => {
  for (const [md, cls] of [
    ['[[Task#1]]', 'mention mention-entity'],
    ['[[table:Product/Task]]', 'mention mention-table'],
    ['[[space:Product]]', 'mention mention-space'],
    ['[[workspace]]', 'mention mention-workspace'],
  ]) {
    assert.equal(chips(renderMarkdown(md, { resolveMention: recordingResolver() }))[0][0], cls, md);
  }
});

test('surrounding whitespace inside the brackets is tolerated', () => {
  const r = recordingResolver();
  renderMarkdown('[[  space:Product  ]] and [[ Task#1 ]]', { resolveMention: r });
  assert.deepEqual(r.calls, [['space', 'Product'], ['entity', 'Task#1']]);
});

test('the kind prefix is case-sensitive', () => {
  const html = renderMarkdown('[[Space:Product]]', { resolveMention: recordingResolver() });
  assert.match(html, /mention broken/);
});

test('an explicit label wins over the resolved one', () => {
  const html = renderMarkdown('[[space:Product|the team]]', { resolveMention: recordingResolver() });
  assert.match(html, />the team</);
  assert.doesNotMatch(html, /\|/, 'the separator must not survive into the output');
});

test('only the first pipe separates — a label may contain more', () => {
  const html = renderMarkdown('[[space:Product|a | b]]', { resolveMention: recordingResolver() });
  assert.equal(chips(html)[0][2], 'a | b');
});

test('a label is trimmed but its inner spacing is kept', () => {
  const html = renderMarkdown('[[space:Product|  the  team  ]]', { resolveMention: recordingResolver() });
  assert.equal(chips(html)[0][2], 'the  team');
});

test('an unknown prefix is not mistaken for a kind', () => {
  const r = recordingResolver();
  renderMarkdown('[[http://example.com]] [[note:x]]', { resolveMention: r });
  assert.deepEqual(r.calls, [], 'neither parses as entity, table, space or workspace');
});

test('an empty or kindless reference resolves nothing', () => {
  const r = recordingResolver();
  const html = renderMarkdown('[[]] [[space:]] [[table:]]', { resolveMention: r });
  assert.deepEqual(r.calls, [], 'a kind with no target must not reach the resolver');
  assert.equal((html.match(/mention broken/g) ?? []).length, 3);
});

test('an unclosed reference is left as literal text', () => {
  const html = renderMarkdown('a [[space:Product', { resolveMention: recordingResolver() });
  assert.match(html, /a \[\[space:Product/);
  assert.doesNotMatch(html, /mention/);
});

test('references inside code are text, not links', () => {
  const inline = renderMarkdown('Type `[[space:Product]]` to link.', { resolveMention: recordingResolver() });
  assert.match(inline, /<code>\[\[space:Product\]\]<\/code>/);
  assert.doesNotMatch(inline, /mention/);

  const fenced = renderMarkdown('```\n[[space:Product]]\n```', { resolveMention: recordingResolver() });
  assert.match(fenced, /<pre><code>\[\[space:Product\]\]/);
  assert.doesNotMatch(fenced, /mention/);
});

test('an unresolvable reference renders as broken, not as a dead link', () => {
  const html = renderMarkdown('[[space:Nope]] [[Ghost#9]]', { resolveMention: () => null });
  assert.equal((html.match(/mention broken/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<a /);
});

test('a reference with no resolver at all is broken, never a crash', () => {
  assert.match(renderMarkdown('[[workspace]]', {}), /mention broken/);
  assert.match(renderMarkdown('[[Task#1]]'), /mention broken/);
});

test('a resolver that throws does not take the document down', () => {
  const html = renderMarkdown('before [[space:X]] after', {
    resolveMention: () => { throw new Error('resolver exploded'); },
  });
  assert.match(html, /mention broken/);
  assert.match(html, /before/);
  assert.match(html, /after/, 'the rest of the document still renders');
});

test('references render inside headings, emphasis, lists and tables', () => {
  const r = recordingResolver();
  for (const md of [
    '# See [[space:Product]]',
    '**[[space:Product]]**',
    '- [[space:Product]]',
    '| a | b |\n| --- | --- |\n| [[space:Product]] | x |',
    '> quoting [[space:Product]]',
  ]) {
    assert.equal(chips(renderMarkdown(md, { resolveMention: r })).length, 1, md);
  }
});

test('several references in one line each resolve independently', () => {
  const html = renderMarkdown('[[space:A]] then [[space:B]] then [[workspace]]',
    { resolveMention: recordingResolver() });
  assert.deepEqual(chips(html).map((c) => c[2]), ['space:A', 'space:B', 'workspace:']);
});

test('html in a label or a reference is escaped, not executed', () => {
  const label = renderMarkdown('[[space:P|<img src=x onerror=alert(1)>]]', { resolveMention: recordingResolver() });
  assert.match(label, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(label, /<img/);

  const ref = renderMarkdown('[[space:<script>alert(1)</script>]]', { resolveMention: recordingResolver() });
  assert.doesNotMatch(ref, /<script>/);

  const href = renderMarkdown('[[space:P]]', {
    resolveMention: () => ({ href: '"><script>alert(1)</script>', label: 'x' }),
  });
  assert.doesNotMatch(href, /<script>/);
});

test('a broken chip escapes its contents as well', () => {
  const html = renderMarkdown('[[space:<b>x</b>]]', { resolveMention: () => null });
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('the server resolves every kind to a real, working URL', async () => {
  const { w, t } = buildWorkspace();
  await withServer(w, async ({ render }) => {
    const space = w.getSpace('Product');
    const table = w.getTable('Product/Task');

    assert.match(await render('[[Task#1]]'), new RegExp(`href="/e/${t.id}`));
    assert.match(await render('[[table:Product/Task]]'), new RegExp(`href="/?#/table/${table.id}"`));
    assert.match(await render('[[space:Product]]'), new RegExp(`href="/?#/space/${space.id}"`));

    const ws = await render('[[workspace]]');
    assert.match(ws, /href="\/"/);
    assert.match(ws, />demo</, 'the workspace mention is labelled with its name');

    assert.match(await render('[[table:Task]]'), new RegExp(`href="/?#/table/${table.id}"`));
    assert.match(await render('[[space:Nope]]'), /mention broken/);
  });
});

test('an entity reference is labelled with its table, id and name', async () => {
  const { w } = buildWorkspace();
  await withServer(w, async ({ render }) => {
    assert.equal(chips(await render('[[Task#1]]'))[0][2], 'Task#1 — Ship it');
    assert.match(await render('[[Task#1]]'), /data-name="Ship it"/);
  });
});

test('an ambiguous bare table name is a broken chip, not a 500', async () => {
  const w = new Weave();
  w.createSpace({ name: 'A' });
  w.createSpace({ name: 'B' });
  w.createTable({ space: 'A', name: 'Task' });
  w.createTable({ space: 'B', name: 'Task' });
  await withServer(w, async ({ render }) => {
    assert.match(await render('[[table:Task]]'), /mention broken/);
    assert.match(await render('[[table:A/Task]]'), /mention mention-table/);
    assert.match(await render('[[Task#1]]'), /mention broken/);
  });
});

test('a reference to a trashed entity is broken until it is restored', async () => {
  const { w, tasks } = buildWorkspace();
  const gone = w.createEntity(tasks, { name: 'Gone' });
  await withServer(w, async ({ render }) => {
    assert.match(await render(`[[Task#${gone.publicId}]]`), /mention mention-entity/);
    w.deleteEntity(gone.id);
    assert.match(await render(`[[Task#${gone.publicId}]]`), /mention broken/,
      'the trash is not linkable');
    w.restoreEntity(gone.id);
    assert.match(await render(`[[Task#${gone.publicId}]]`), /mention mention-entity/);
  });
});

test('a reference to a deleted table or space breaks cleanly', async () => {
  const { w, tasks } = buildWorkspace();
  await withServer(w, async ({ render }) => {
    assert.match(await render('[[table:Product/Task]]'), /mention mention-table/);
    w.deleteTable(tasks.id);
    assert.match(await render('[[table:Product/Task]]'), /mention broken/);
    w.deleteSpace('Product');
    assert.match(await render('[[space:Product]]'), /mention broken/);
  });
});

test('links carry the workspace prefix when the request is scoped', async () => {
  const { w } = buildWorkspace();
  const side = new Weave();
  side.state.meta.name = 'side';
  side.createSpace({ name: 'S' });
  await withServer(w, async ({ render }) => {
    const scoped = await render('[[space:S]] [[workspace]]', '/w/side');
    assert.match(scoped, /href="\/w\/side\/#\/space\//, 'a scoped space link keeps its prefix');
    assert.match(scoped, /href="\/w\/side\/"/, 'the workspace link points at that workspace');
    assert.match(scoped, />side</, 'and is labelled with that workspace name');
    assert.match(await render('[[space:S]]'), /mention broken/);
  }, { workspaces: { side } });
});

test('the in-app preview and the document page render identical chips', async () => {
  const { w, t } = buildWorkspace();
  const md = 'Ref [[Task#1]], [[space:Product]], [[table:Product/Task]] and [[workspace]].';
  w.setDoc(t.id, md);
  await withServer(w, async ({ render, get }) => {
    const preview = chips(await render(md));
    const page = chips((await get(`/e/${t.id}/doc.html`)).text);
    assert.equal(preview.length, 4, 'all four kinds resolved');
    assert.deepEqual(page, preview,
      'both surfaces go through src/markdown.js — divergence here means two renderers');
  });
});

test('every export path survives a document full of references', async () => {
  const { w, t } = buildWorkspace();
  const md = 'See [[space:Product]] and [[Nope#9]].';
  w.setDoc(t.id, md);
  await withServer(w, async ({ get }) => {
    const raw = await get(`/e/${t.id}/doc.md`);
    assert.equal(raw.status, 200);
    assert.match(raw.text, /\[\[space:Product\]\]/, 'markdown is source: references are not expanded');

    const html = await get(`/e/${t.id}/doc.html`);
    assert.equal(html.status, 200);
    assert.match(html.text, /mention mention-space/);
    assert.match(html.text, /mention broken/, 'a broken reference does not fail the page');

    const pdf = await get(`/e/${t.id}/doc.pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.text.slice(0, 5), /^%PDF-/);
  });
});

test('storing a reference never rewrites the markdown', async () => {
  const { w, t } = buildWorkspace();
  const md = 'See [[space:Product]] and [[table:Product/Task|the tasks]].';
  w.setDoc(t.id, md);
  assert.equal(w.getDoc(t.id), md);
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  assert.equal(copy.getDoc(t.id), md);
});

test('both stylesheets give every kind the same glyph', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(join(root, 'src/markdown.js'), 'utf8');
  const app = readFileSync(join(root, 'public/style.css'), 'utf8');
  for (const [kind, glyph] of [['entity', '#'], ['table', '▦'], ['space', '◇'], ['workspace', '⬡']]) {
    const rule = new RegExp(`mention-${kind}::before \\{ content: "${glyph}"`);
    assert.match(page, rule, `${kind} glyph missing from the document page`);
    assert.match(app, rule, `${kind} glyph missing from the in-app preview`);
  }
});
