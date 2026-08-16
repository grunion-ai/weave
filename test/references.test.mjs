/* Typed `[[…]]` references (Kyle, 2026-08-16).

   `[[Table#12]]` addressed entities only. A document can now point at
   anything addressable, in a form that stays readable in raw markdown:

     [[Feature#70]]                  entity (unchanged)
     [[table:Development/Feature]]   table
     [[space:Development]]           space
     [[workspace]]                   this workspace
     [[space:Development|the team]]  any of them with a label

   The parser only splits kind from reference; the resolver decides what each
   kind addresses and what it links to, so exactly one place knows the URL
   shapes. Two invariants are load-bearing and tested below:

   1. A reference that cannot be resolved renders as a BROKEN CHIP, never a
      dead link and never a 500 — a document is user input and an ambiguous
      or malformed reference must not be able to take a page down.
   2. The in-app preview (POST /api/markdown) and the standalone document
      page (/e/:id/doc.html) go through the SAME renderer and must produce
      byte-identical chips. This is the argument against adopting a second
      markdown engine, so it is pinned rather than asserted in prose. */

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

// Starts a server, runs body(helpers), always closes. Keeps every HTTP test
// from repeating the same six lines of setup and teardown.
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

// Every resolved chip in a fragment, as [class, href, text] triples.
const chips = (html) =>
  [...html.matchAll(/<a class="(mention mention-\w+)" href="([^"]+)">([^<]*)<\/a>/g)]
    .map((m) => [m[1], m[2], m[3]]);

// The renderer is handed a resolver; these tests use a recording stub so the
// parse contract can be checked without a server.
function recordingResolver(calls = []) {
  const fn = (kind, ref) => {
    calls.push([kind, ref]);
    return { href: `/x/${kind}/${ref}`, label: `${kind}:${ref}` };
  };
  fn.calls = calls;
  return fn;
}

/* ---------- parsing: kind and reference ---------- */

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
  // Lowercase is the documented form; accepting variants would mean two
  // spellings of the same reference living in documents.
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

/* ---------- parsing: what is NOT a reference ---------- */

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
  // Someone documenting the syntax must be able to show it.
  const inline = renderMarkdown('Type `[[space:Product]]` to link.', { resolveMention: recordingResolver() });
  assert.match(inline, /<code>\[\[space:Product\]\]<\/code>/);
  assert.doesNotMatch(inline, /mention/);

  const fenced = renderMarkdown('```\n[[space:Product]]\n```', { resolveMention: recordingResolver() });
  assert.match(fenced, /<pre><code>\[\[space:Product\]\]/);
  assert.doesNotMatch(fenced, /mention/);
});

/* ---------- failure is always a broken chip ---------- */

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

/* ---------- references compose with the rest of markdown ---------- */

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

/* ---------- escaping ---------- */

test('html in a label or a reference is escaped, not executed', () => {
  const label = renderMarkdown('[[space:P|<img src=x onerror=alert(1)>]]', { resolveMention: recordingResolver() });
  assert.match(label, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(label, /<img/);

  const ref = renderMarkdown('[[space:<script>alert(1)</script>]]', { resolveMention: recordingResolver() });
  assert.doesNotMatch(ref, /<script>/);

  // A hostile href from a resolver is escaped too.
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

/* ---------- the server's resolver is the authority on links ---------- */

test('the server resolves every kind to a real, working URL', async () => {
  const { w, t } = buildWorkspace();
  await withServer(w, async ({ render }) => {
    const space = w.listSpaces()[0];
    const table = w.getTable('Product/Task');

    assert.match(await render('[[Task#1]]'), new RegExp(`href="/e/${t.id}`));
    assert.match(await render('[[table:Product/Task]]'), new RegExp(`href="/?#/table/${table.id}"`));
    assert.match(await render('[[space:Product]]'), new RegExp(`href="/?#/space/${space.id}"`));

    const ws = await render('[[workspace]]');
    assert.match(ws, /href="\/"/);
    assert.match(ws, />demo</, 'the workspace mention is labelled with its name');

    // A table is addressable by bare name too, the way the CLI accepts it.
    assert.match(await render('[[table:Task]]'), new RegExp(`href="/?#/table/${table.id}"`));
    // …and a miss is broken rather than a link to nowhere.
    assert.match(await render('[[space:Nope]]'), /mention broken/);
  });
});

test('an entity reference is labelled with its table, id and name', async () => {
  const { w } = buildWorkspace();
  await withServer(w, async ({ render }) => {
    assert.equal(chips(await render('[[Task#1]]'))[0][2], 'Task#1 — Ship it');
  });
});

test('an ambiguous bare table name is a broken chip, not a 500', async () => {
  const w = new Weave();
  w.createSpace({ name: 'A' });
  w.createSpace({ name: 'B' });
  w.createTable({ space: 'A', name: 'Task' });
  w.createTable({ space: 'B', name: 'Task' }); // same bare name in two spaces
  await withServer(w, async ({ render }) => {
    assert.match(await render('[[table:Task]]'), /mention broken/);
    // Qualifying it disambiguates.
    assert.match(await render('[[table:A/Task]]'), /mention mention-table/);
    // The entity resolver goes through the same lookup, so it degrades too.
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
    // The default workspace is unprefixed, and cannot see the sibling's space.
    assert.match(await render('[[space:S]]'), /mention broken/);
  }, { workspaces: { side } });
});

/* ---------- one renderer, two surfaces ---------- */

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
  // …and it round-trips through export/import unchanged.
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  assert.equal(copy.getDoc(t.id), md);
});

/* ---------- kind glyphs ---------- */

test('both stylesheets give every kind the same glyph', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(join(root, 'src/markdown.js'), 'utf8');   // standalone document page
  const app = readFileSync(join(root, 'public/style.css'), 'utf8');   // in-app preview
  for (const [kind, glyph] of [['entity', '#'], ['table', '▦'], ['space', '◇'], ['workspace', '⬡']]) {
    const rule = new RegExp(`mention-${kind}::before \\{ content: "${glyph}"`);
    assert.match(page, rule, `${kind} glyph missing from the document page`);
    assert.match(app, rule, `${kind} glyph missing from the in-app preview`);
  }
});
