// References are not relations (Kyle, 2026-09-01): a chip in a document is
// tracked as a reference, computed from the text on demand. Each entity
// answers /api/entities/:ref/references with the entities whose documents
// mention it, in every accepted spelling. Preview fields feed the collapsible
// chip: workflow state first, then non-empty values in schema order, three at
// most, zero configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { renderMarkdown } from '../src/markdown.js';
import { startServer } from '../src/server.js';

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const tasks = w.createTable({ space: 'Dev', name: 'Task' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  w.addField(tasks, {
    name: 'State', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'In Progress', category: 'in-progress' },
        { name: 'Done', category: 'done' },
      ],
    },
  });
  w.addField(tasks, { name: 'Due', type: 'date' });
  w.addField(tasks, { name: 'Notes', type: 'text' });
  const target = w.createEntity('Task', { name: 'Ship the editor' });
  return { w, target };
}

test('previewFields: workflow first, then non-empty in schema order, capped at 3', () => {
  const { w, target } = seed();
  w.setState(target.id, 'State', 'In Progress');
  w.updateEntity(target.id, { Due: '2026-09-12', Notes: 'polish pass' });
  const fields = w.previewFields(target.id);
  assert.equal(fields.length, 3);
  assert.deepEqual(fields[0], { label: 'State', value: 'In Progress' });
  assert.deepEqual(fields[1], { label: 'Due', value: '2026-09-12' });
  assert.deepEqual(fields[2], { label: 'Notes', value: 'polish pass' });
});

test('previewFields: empty values are skipped, name field never appears', () => {
  const { w, target } = seed();
  const fields = w.previewFields(target.id);
  // Only the default workflow state is set on a fresh entity.
  assert.deepEqual(fields.map((f) => f.label), ['State']);
  assert.equal(fields[0].value, 'Open');
  assert.ok(!fields.some((f) => f.label === 'Name'));
});

test('referencesTo finds every accepted spelling and nothing else', () => {
  const { w, target } = seed();
  const byPid = w.createEntity('Issue', { name: 'bracket pid', doc: 'see [[Task#1]] for context' });
  const byQualified = w.createEntity('Issue', { name: 'qualified', doc: 'see [[ Dev/Task#1 | the ship ]]' });
  const byUuid = w.createEntity('Issue', { name: 'uuid', doc: `see [[${target.id}]]` });
  const byLink = w.createEntity('Issue', { name: 'permalink', doc: `see [Ship](https://weave.local:4400/w/weave/e/${target.id}) now` });
  w.createEntity('Issue', { name: 'bystander', doc: 'mentions [[Task#99]] and #Task-1 but not the target' });
  w.createEntity('Issue', { name: 'no doc at all' });

  const refs = w.referencesTo(target.id);
  const names = refs.map((r) => r.name).sort();
  assert.deepEqual(names, ['bracket pid', 'permalink', 'qualified', 'uuid'].sort());
  // Summaries carry what a chip needs.
  for (const r of refs) {
    assert.ok(r.id && r.publicId && r.db === 'Dev/Issue');
  }
  assert.ok([byPid, byQualified, byUuid, byLink].every(Boolean));
});

test('referencesTo: deleted referrers drop out; the entity never references itself', () => {
  const { w, target } = seed();
  const ref = w.createEntity('Issue', { name: 'doomed', doc: 'see [[Task#1]]' });
  w.setDoc(target.id, 'I am [[Task#1]] myself');
  assert.equal(w.referencesTo(target.id).length, 1);
  w.deleteEntity(ref.id);
  assert.equal(w.referencesTo(target.id).length, 0);
});

test('GET /api/entities/:ref/references serves the backlinks', async () => {
  const { w, target } = seed();
  w.createEntity('Issue', { name: 'caller', doc: 'blocked by [[Task#1]]' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/entities/${target.id}/references`);
    assert.equal(res.status, 200);
    const refs = await res.json();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, 'caller');
  } finally {
    server.close();
  }
});

test('mention chip with preview fields collapses behind a caret and stays a link', () => {
  const resolver = () => ({
    href: '/w/weave/e/abc/doc.html',
    label: 'Ship the editor',
    fields: [
      { label: 'State', value: 'In Progress' },
      { label: 'Due', value: '2026-09-12' },
      { label: 'Owner', value: 'Kyle' },
      { label: 'Fourth', value: 'never shown' },
    ],
  });
  const html = renderMarkdown('[[Task#1]]', { resolveMention: resolver });
  assert.match(html, /<span class="mention-wrap"><a class="mention mention-entity" href="\/w\/weave\/e\/abc\/doc.html">/);
  assert.match(html, /<button type="button" class="mention-caret" aria-expanded="false"/);
  assert.match(html, /mention-f-label">State<\/span>In Progress/);
  assert.match(html, /Due<\/span>2026-09-12/);
  assert.ok(!html.includes('never shown'), 'preview caps at three fields');
});

test('mention chip without fields renders exactly as before', () => {
  const resolver = () => ({ href: '/e/abc/doc.html', label: 'Plain' });
  const html = renderMarkdown('[[Task#1]]', { resolveMention: resolver });
  assert.equal(html.includes('mention-wrap'), false);
  assert.equal(html.includes('mention-caret'), false);
  assert.match(html, /<a class="mention mention-entity" href="\/e\/abc\/doc.html">Plain<\/a>/);
});

/* ---------- the outbound mirror: what this document mentions ----------
   Same ruling, other direction (Kyle, 2026-09-02): the chips a document
   carries ARE its outbound references — computed from the text, deduped,
   1:1 with what the text says right now. Never stored, never linkable,
   never unlinkable. Spellings match referencesTo exactly, which now also
   reads an HTML chip's href and a mermaid click target: they all reduce
   to /e/<uuid>. */

test('referencesFrom finds every accepted spelling and dedupes to one entry', () => {
  const { w, target } = seed();
  const issue = w.createEntity('Issue', {
    name: 'omnibus',
    doc: `see [[Task#1]] then [[ Dev/Task#1 | the ship ]] then [[${target.id}]] ` +
      `and [Ship](https://weave.local:4400/w/weave/e/${target.id}) once more`,
  });
  const refs = w.referencesFrom(issue.id);
  assert.equal(refs.length, 1, 'four spellings of one target are one reference');
  const { chip, ...bare } = refs[0];
  assert.deepEqual(bare, { id: target.id, publicId: 1, name: 'Ship the editor', db: 'Dev/Task' });
  assert.equal(chip.shape, 'chip', 'a reference carries the far row’s chip, like a relation does');
});

test('referencesFrom reads HTML chips and mermaid click targets', () => {
  const { w, target } = seed();
  const htmlDoc = w.createEntity('Issue', {
    name: 'html chip',
    doc: `<!doctype html>\n<html><body><a href="/e/${target.id}">Ship</a></body></html>`,
  });
  const mmdDoc = w.createEntity('Issue', {
    name: 'diagram',
    doc: `graph LR\n  A --> B\n  click A "/e/${target.id}"`,
  });
  assert.equal(w.referencesFrom(htmlDoc.id).length, 1);
  assert.equal(w.referencesFrom(mmdDoc.id).length, 1);
  // And the inbound scan agrees — both directions share the spellings.
  const inbound = w.referencesTo(target.id).map((r) => r.name).sort();
  assert.deepEqual(inbound, ['diagram', 'html chip']);
});

test('referencesFrom is 1:1 with the text: edits, dead refs, self and deleted targets', () => {
  const { w, target } = seed();
  const issue = w.createEntity('Issue', { name: 'edited', doc: 'see [[Task#1]] and dead [[Task#99]]' });
  assert.equal(w.referencesFrom(issue.id).length, 1, 'a dead pid stays text, never a reference');
  w.setDoc(issue.id, 'the mention is gone now');
  assert.equal(w.referencesFrom(issue.id).length, 0, 'the reference lives exactly as long as the text');
  w.setDoc(target.id, 'I am [[Task#1]] myself');
  assert.equal(w.referencesFrom(target.id).length, 0, 'an entity never references itself');
  w.setDoc(issue.id, 'back to [[Task#1]]');
  w.deleteEntity(target.id);
  assert.equal(w.referencesFrom(issue.id).length, 0, 'a deleted target drops out');
});

test('referencesFrom sorts by db then publicId, across tables', () => {
  const { w, target } = seed();
  const other = w.createEntity('Issue', { name: 'sibling' });
  const note = w.createEntity('Issue', { name: 'note', doc: `[[Issue#${other.publicId}]] and [[Task#1]]` });
  const refs = w.referencesFrom(note.id);
  assert.deepEqual(refs.map((r) => r.db), ['Dev/Issue', 'Dev/Task']);
  assert.equal(refs[1].id, target.id);
});

test('GET /api/entities/:ref/references-from serves the outbound refs', async () => {
  const { w, target } = seed();
  const issue = w.createEntity('Issue', { name: 'caller', doc: 'blocked by [[Task#1]]' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/entities/${issue.id}/references-from`);
    assert.equal(res.status, 200);
    const refs = await res.json();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].id, target.id);
  } finally {
    server.close();
  }
});

/* ---------- references live in the side column, house chips ----------
   (Kyle, 2026-09-02): references are hidden from the entity view by default,
   exactly like comments and activity — they live in the entity-side column
   the Activity button opens, so the resting page never mentions them and
   nothing is even fetched until the reader asks. The chips are formatted
   exactly like a linked relation chip — the k k-rel span with its k-home
   table badge. Source-level gate. */

test('reference panels join the opt-in side column and wear k k-rel chips', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const refCard'), src.indexOf('deck is composed on read'));
  assert.ok(block.includes('right.append'), 'panels join the entity-side column, never the body');
  assert.ok(block.includes('sideOpen'), 'nothing is fetched until the side column is open');
  assert.ok(block.includes('card panel ref-backlinks-card'), 'same panel dress as Activity and Comments');
  assert.ok(block.includes('relationChipEl({ targetDbIds: true }, r)'), 'chips are the shared relation chip — the far row’s Chip, wearing its home table badge');
  assert.ok(!block.includes('left.append'), 'the entity body stays quiet');
});
