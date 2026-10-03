import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

await import('../public/history-core.js');
const core = globalThis.weaveHistoryCore;

function record() {
  const w = new Weave({ revisionWindowMs: 0 });
  w.createSpace({ name: 'Dev' });
  const t = w.createTable({ space: 'Dev', name: 'Issue' });
  w.addField(t, { name: 'Spec', type: 'document' });
  w.addField(t, { name: 'Priority', type: 'select', config: { options: ['P1', 'P2'] } });
  const e = w.createEntity(t, { name: 'A', doc: 'one', values: { Priority: 'P2' } });
  return { w, t, e };
}
const feedOf = (w, id) => {
  const ent = w.getEntity(id);
  const table = w.state.tables[ent.dbId];
  const documents = Object.values(table.fields).filter((f) => f.type === 'document')
    .map((f) => ({ field: f.name, revisions: w.listDocRevisions(id, f.name, { limit: 200 }).revisions }));
  const activity = w.activityFeed({ entityId: id, limit: 500 }).items;
  const opt = (field, v) => Object.values(table.fields).find((f) => f.name === field)?.config?.options?.find((o) => o.id === v)?.name ?? v;
  return core.feed({ documents, activity, comments: ent.comments ?? [], optionName: opt });
};

test('one feed: every document, field changes and comments, newest first; revisions stand for doc-updated', () => {
  const { w, e } = record();
  w.setDoc(e.id, 'one two', 'Description');
  w.setDoc(e.id, 'spec text', 'Spec');
  w.updateEntity(e.id, { Priority: 'P1' });
  w.addComment(e.id, { author: 'kyle', text: 'looks right' });
  const items = feedOf(w, e.id);
  const kinds = items.map((i) => i.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'rev'), ['comment', 'field'], 'the comment is newest, then the field change');
  assert.equal(items.filter((i) => i.kind === 'rev' && i.field === 'Description').length, 2);
  assert.equal(items.filter((i) => i.kind === 'rev' && i.field === 'Spec').length, 1);
  assert.ok(!items.some((i) => i.kind === 'doc-updated'), 'no doc-updated rows beside the revisions');
  const pri = items.find((i) => i.kind === 'field');
  assert.deepEqual([pri.field, pri.from, pri.to], ['Priority', 'P2', 'P1'], 'option ids read as their labels');
  assert.equal(items.find((i) => i.kind === 'comment').body, 'looks right');
  for (let i = 1; i < items.length; i++) assert.ok(Date.parse(items[i - 1].at) >= Date.parse(items[i].at), 'newest first');
});

test('each document knows its own current revision and delta', () => {
  const { w, e } = record();
  w.setDoc(e.id, 'one two three', 'Description');
  w.setDoc(e.id, 'spec', 'Spec');
  const revs = feedOf(w, e.id).filter((i) => i.kind === 'rev');
  const desc = revs.filter((r) => r.field === 'Description');
  assert.equal(desc[0].current, true);
  assert.equal(desc[1].current, false);
  assert.equal(desc[0].delta, 'one two three'.length - 'one'.length);
  assert.equal(desc.at(-1).first, true);
  assert.equal(revs.find((r) => r.field === 'Spec').current, true, 'Spec has its own current');
});

test('a restore is marked with the revision it brought back; an undo marks what it took back', () => {
  const { w, e } = record();
  w.setDoc(e.id, 'two', 'Description');
  const first = w.listDocRevisions(e.id).revisions.at(-1);
  w.restoreDocRevision(e.id, null, first.seq);
  let revs = feedOf(w, e.id).filter((i) => i.kind === 'rev');
  assert.equal(revs[0].restoredFrom, first.seq);
  assert.deepEqual(revs[0].source, { at: first.at, actor: first.actor }, 'the restored version is named by when and by whom (Issue #588)');
  assert.equal(revs[1].restoredFrom, undefined, 'the edit before it is plain');
  w.updateEntity(e.id, { Priority: 'P1' });
  w.undo();
  const items = feedOf(w, e.id);
  const change = items.find((i) => i.kind === 'field');
  assert.equal(change.undone, true, 'the change the undo took back is marked');
  const undo = items.find((i) => i.kind === 'undo');
  assert.deepEqual([undo.field, undo.from, undo.to], ['Priority', 'P1', 'P2'], 'the undo row reads as the change it made');
});

test('filters: all, one document, fields, comments', () => {
  const { w, e } = record();
  w.setDoc(e.id, 'spec', 'Spec');
  w.updateEntity(e.id, { Priority: 'P1' });
  w.addComment(e.id, { author: 'kyle', text: 'hi' });
  const items = feedOf(w, e.id);
  assert.equal(core.filterFeed(items, 'all').length, items.length);
  assert.ok(core.filterFeed(items, 'doc:Spec').every((i) => i.kind === 'rev' && i.field === 'Spec'));
  assert.deepEqual(core.filterFeed(items, 'fields').map((i) => i.kind), ['field']);
  assert.deepEqual(core.filterFeed(items, 'comments').map((i) => i.kind), ['comment']);
});

test('diff: kept text plain, changed sentences word by word, rewrites out and in, headings stay headings', () => {
  const html = core.renderDiff('## Scope\n\nThe panel lists rows. It is slow.', '## Scope\n\nThe panel lists every row. Nothing else.');
  assert.match(html, /^<h4>Scope<\/h4>/, 'an unchanged heading is a plain heading');
  assert.match(html, /<p class="mod">The panel lists <del>rows\.<\/del><ins>every row\.<\/ins>/, 'a mostly kept sentence diffs by word');
  assert.match(html, /<del>It is slow\.<\/del> <ins>Nothing else\.<\/ins>/, 'a rewritten sentence reads out then in');
  assert.match(core.renderDiff('', 'new'), /<p class="add"><ins>new<\/ins><\/p>/);
  assert.match(core.renderDiff('gone', ''), /<p class="rem"><del>gone<\/del><\/p>/);
  assert.match(core.renderDiff('same', 'same'), /^<p>same<\/p>$/);
  assert.match(core.renderDiff('', ''), /No changes/);
});

test('diff: long unchanged runs fold to a count; text is escaped', () => {
  const keep = ['a', 'b', 'c', 'd'].join('\n\n');
  assert.match(core.renderDiff(`${keep}\n\nold`, `${keep}\n\nnew`), /<p class="fold">2 unchanged paragraphs<\/p>/);
  assert.match(core.renderDiff('a\n\nb\n\nc\n\nx', 'a\n\nb\n\nc\n\ny'), /1 unchanged paragraph</);
  assert.doesNotMatch(core.renderDiff('', '<script>x</script>'), /<script>/);
});

test('diff: lists, tables and code keep their lines and diff line by line', () => {
  const html = core.renderDiff('- [ ] one\n- [ ] two', '- [x] one\n- [ ] two\n- [ ] three');
  assert.match(html, /^<div class="src mod">/, 'a list is a src block');
  assert.match(html, /- <del>\[ \]<\/del><ins>\[x\]<\/ins> one\n- \[ \] two\n<ins>- \[ \] three<\/ins>/, 'the ticked box diffs inside its line; the new line is added whole');
  assert.match(core.renderDiff('', '| a | b |\n| --- | --- |'), /<div class="src code add">/, 'a table reads in the monospace face');
  assert.match(core.renderDiff('```\nx\n```', '```\ny\n```'), /class="src code mod"/);
});

test('day labels: Today, Yesterday, then a short date', () => {
  const now = new Date('2026-10-03T15:00:00');
  assert.equal(core.dayLabel('2026-10-03T09:00:00', now), 'Today');
  assert.equal(core.dayLabel('2026-10-02T09:00:00', now), 'Yesterday');
  assert.match(core.dayLabel('2026-09-29T09:00:00', now), /Sep/);
});
