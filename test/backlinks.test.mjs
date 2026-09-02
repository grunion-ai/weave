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
