import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { renderMarkdown } from '../src/markdown.js';
import { withServer } from './lib/fixtures.mjs';

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
  assert.deepEqual(fields[1], { label: 'Due', value: 'Sep 12, 2026' });
  assert.deepEqual(fields[2], { label: 'Notes', value: 'polish pass' });
});

test('previewFields: empty values are skipped, name field never appears', () => {
  const { w, target } = seed();
  const fields = w.previewFields(target.id);
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
  await withServer(w, async ({ base }) => {
    const res = await fetch(`${base}/api/entities/${target.id}/references`);
    assert.equal(res.status, 200);
    const refs = await res.json();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, 'caller');
  });
});

test('mention chip with preview fields collapses behind a caret and stays a link', () => {
  const resolver = () => ({
    href: '/w/weave/e/abc/doc.html',
    label: 'Ship the editor',
    fields: [
      { label: 'State', value: 'In Progress' },
      { label: 'Due', value: 'Sep 12, 2026' },
      { label: 'Owner', value: 'Kyle' },
      { label: 'Fourth', value: 'never shown' },
    ],
  });
  const html = renderMarkdown('[[Task#1]]', { resolveMention: resolver });
  assert.match(html, /<span class="k k-rel kind-entity has-segs">/);
  assert.match(html, /<a class="mention mention-entity" href="\/w\/weave\/e\/abc\/doc.html"[^>]*><span class="k-label">Ship the editor<\/span><\/a><span class="mention-fields">/);
  assert.match(html, /<\/span><button type="button" class="mention-caret" aria-expanded="false"/, 'the caret is the link\'s sibling, so it is a target of its own (Issue #397)');
  assert.match(html, /mention-f-label">State<\/span>In Progress/);
  assert.match(html, /mention-f-label">Due<\/span>Sep 12, 2026/);
  assert.ok(!html.includes('never shown'), 'preview caps at three fields');
});

test('mention chip without fields is the same chip, minus the strip and the caret', () => {
  const resolver = () => ({ href: '/e/abc/doc.html', label: 'Plain' });
  const html = renderMarkdown('[[Task#1]]', { resolveMention: resolver });
  assert.equal(html.includes('mention-fields'), false);
  assert.equal(html.includes('mention-caret'), false);
  assert.match(html, /<span class="k k-rel kind-entity"><a class="mention mention-entity" href="\/e\/abc\/doc.html" title="Plain" data-name="Plain"><span class="k-label">Plain<\/span><\/a><\/span>/);
});

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

test('referencesFrom keeps permalinks into another workspace as external entries (Issue #1478)', () => {
  const { w, target } = seed();
  const other = w.createEntity('Issue', { name: 'local sibling' });
  const farA = '78d5e9de-1111-4222-8333-944455556666';
  const farB = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
  const issue = w.createEntity('Issue', {
    name: 'mixed',
    doc: [
      'see [[Task#1]]',
      `and [sibling](https://weave.local:4400/w/${w.state.meta.name}/e/${other.id})`,
      `then [#1075 PR CI picks browser tests by file name](https://weave.grunion.ai/w/weave/e/${farA})`,
      `and https://net.weave.grunion.ai/e/${farB} bare`,
      `again [dup](https://weave.grunion.ai/w/weave/e/${farA})`,
      'dead /e/ffffffff-ffff-4fff-8fff-ffffffffffff stays text',
      `so does [gone](https://weave.local:4400/w/${w.state.meta.name}/e/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee)`,
    ].join('\n'),
  });
  const refs = w.referencesFrom(issue.id);
  assert.equal(refs.length, 4, 'two local refs plus two cross-workspace permalinks');
  assert.deepEqual(refs.slice(0, 2).map((r) => r.id).sort(), [target.id, other.id].sort());
  assert.deepEqual(refs.slice(2), [
    { id: farA, external: true, workspace: 'weave', name: '#1075 PR CI picks browser tests by file name', url: `https://weave.grunion.ai/w/weave/e/${farA}` },
    { id: farB, external: true, workspace: 'net', name: null, url: `https://net.weave.grunion.ai/e/${farB}` },
  ], 'externals keep slug, uuid and the link text, and never read the far row');
});

test('GET /api/entities/:ref/references-from serves the outbound refs', async () => {
  const { w, target } = seed();
  const issue = w.createEntity('Issue', { name: 'caller', doc: 'blocked by [[Task#1]]' });
  await withServer(w, async ({ base }) => {
    const res = await fetch(`${base}/api/entities/${issue.id}/references-from`);
    assert.equal(res.status, 200);
    const refs = await res.json();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].id, target.id);
  });
});

test('reference panels join the side column and wear k k-rel chips', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const refCard'), src.indexOf('deck is composed on read'));
  assert.ok(block.includes('right.append'), 'panels join the entity-side column, never the body');
  assert.ok(block.includes("refCard('References', 'ref-outbound-card', refsOut)"), 'the references load with the record and open the column (Feature #315)');
  assert.ok(block.includes('card panel ref-backlinks-card'), 'same panel dress as Comments');
  assert.ok(block.includes('relationChipEl({ targetDbIds: true }, r)'), 'chips are the shared relation chip — the far row’s Chip, wearing its home table badge');
  assert.ok(!block.includes('left.append'), 'the entity body stays quiet');
});

test('a table keeps which reference panels its records show, off by default (Issue #1479)', () => {
  const { w } = seed();
  const panels = () => w.describeSchema().flatMap((s) => s.tables).find((t) => t.name === 'Task').referencePanels;
  assert.equal(panels(), undefined, 'a table nobody touched shows neither panel');
  w.updateTable('Task', { referencePanels: ['References'] });
  assert.deepEqual(panels(), ['References']);
  w.updateTable('Task', { referencePanels: ['Referenced by', 'References', 'References'] });
  assert.deepEqual(panels(), ['References', 'Referenced by'], 'stored once each, in panel order');
  assert.throws(() => w.updateTable('Task', { referencePanels: ['Backlinks'] }), /not a reference panel/);
  w.updateTable('Task', { referencePanels: [] });
  assert.equal(panels(), undefined, 'switching both off clears it');
});
