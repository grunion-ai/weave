/* Typed `[[…]]` references (Kyle, 2026-08-16).

   `[[Table#12]]` addressed entities only. A document should be able to point
   at any addressable thing in the workspace — an entity, a table, a space, or
   the workspace itself — in a form that stays readable in raw markdown:

     [[Feature#70]]                  entity (unchanged)
     [[table:Development/Feature]]   table
     [[space:Development]]           space
     [[workspace]]                   this workspace
     [[space:Development|the team]]  any of them with a label

   The resolver is the single place that knows how each kind is addressed, so
   the renderer stays a parser and the server stays the authority on links. */

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

// The renderer is handed a resolver; these tests use a recording stub so the
// parse contract can be checked without a server.
function recordingResolver(calls) {
  return (kind, ref) => {
    calls.push([kind, ref]);
    return { href: `/x/${kind}/${ref}`, label: `${kind}:${ref}` };
  };
}

test('the resolver is called with a kind and a reference', () => {
  const calls = [];
  renderMarkdown('[[Task#1]] [[table:Product/Task]] [[space:Product]] [[workspace]]',
    { resolveMention: recordingResolver(calls) });
  assert.deepEqual(calls, [
    ['entity', 'Task#1'],
    ['table', 'Product/Task'],
    ['space', 'Product'],
    ['workspace', ''],
  ]);
});

test('each kind renders as a mention link carrying its kind', () => {
  const html = renderMarkdown('[[space:Product]]', { resolveMention: recordingResolver([]) });
  assert.match(html, /<a class="mention mention-space" href="\/x\/space\/Product">space:Product<\/a>/);
  const ent = renderMarkdown('[[Task#1]]', { resolveMention: recordingResolver([]) });
  assert.match(ent, /class="mention mention-entity"/);
});

test('an explicit label wins over the resolved one', () => {
  const html = renderMarkdown('[[space:Product|the team]]', { resolveMention: recordingResolver([]) });
  assert.match(html, />the team</);
  // A label may contain spaces and punctuation but not break the link.
  assert.doesNotMatch(html, /\|/);
});

test('an unresolvable reference renders as broken, not as a dead link', () => {
  const html = renderMarkdown('[[space:Nope]] [[Ghost#9]]', { resolveMention: () => null });
  assert.equal((html.match(/mention broken/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<a /);
});

test('a reference with no resolver at all is broken, never a crash', () => {
  const html = renderMarkdown('[[workspace]]', {});
  assert.match(html, /mention broken/);
});

test('an unknown kind prefix is not mistaken for a reference kind', () => {
  const calls = [];
  renderMarkdown('[[http://example.com]]', { resolveMention: recordingResolver(calls) });
  // Falls through to the entity branch, which cannot parse it → no call.
  assert.deepEqual(calls, []);
});

/* ---------- the server's resolver is the authority on links ---------- */

test('the server resolves every kind to a real, working URL', async () => {
  const { w, t } = buildWorkspace();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const render = async (md) => {
    const res = await fetch(`${base}/api/markdown`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md }),
    });
    return (await res.json()).html;
  };
  try {
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
  } finally {
    server.close();
  }
});

test('references survive a round trip through a document', async () => {
  const { w, t } = buildWorkspace();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const md = 'See [[space:Product]] and [[table:Product/Task]].';
    w.setDoc(t.id, md);
    const html = await (await fetch(`${base}/e/${t.id}/doc.html`)).text();
    assert.match(html, /mention mention-space/);
    assert.match(html, /mention mention-table/);
    // The stored markdown is untouched — the reference is source, not markup.
    assert.equal(w.getDoc(t.id), md);
  } finally {
    server.close();
  }
});
