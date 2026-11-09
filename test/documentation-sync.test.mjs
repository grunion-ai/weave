import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tempDir } from './lib/temp.mjs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { syncDocumentationPresentation } from '../src/documentation-presentation.js';

const dir = tempDir('weave-docs-sync-');
const bannerPath = join(dir, 'banner.svg');
writeFileSync(bannerPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 2"/>');
test.after(() => rmSync(dir, { recursive: true, force: true }));

function fixture() {
  const w = new Weave();
  for (const name of ['Handbook', 'Development', 'Quality']) w.createSpace({ name });
  const guide = w.createTable({ space: 'Handbook', name: 'Guide' });
  const row = w.createEntity(guide, { name: 'Start here', doc: '# Keep my prose' });
  const other = w.createEntity(guide, { name: 'My notes', doc: '# Independent' });
  for (const name of ['Issue', 'Feature', 'Suite', 'Case']) {
    const t = w.createTable({ space: name === 'Issue' || name === 'Feature' ? 'Development' : 'Quality', name });
    w.createEntity(t, { name: 'Keep this record', doc: '# History matters' });
  }
  const presentation = {
    spaces: [{ name: 'Handbook', bannerPath, html: '<h1>Read and try</h1>' }],
    tables: [{ name: 'Development/Issue', bannerPath, html: '<p>Public work</p>', description: 'Do not overwrite this schema' }],
    guides: [{ name: 'Start here', bannerPath, html: '<p>Start with a workspace.</p>' }],
  };
  return { w, row, other, presentation };
}
const sync = (f) => syncDocumentationPresentation(f.w, { presentation: f.presentation });
const intro = (f) => f.w.findField(f.w.getTable('Handbook/Guide'), 'Documentation introduction');
const current = (f) => f.w.getEntity(f.row.id).values[intro(f).id][0];
const protectedState = (w) => JSON.stringify(Object.values(w.state.tables).filter(t => ['Issue', 'Feature', 'Suite', 'Case'].includes(t.name)).map(t => ({ t, rows: Object.values(w.state.entities).filter(e => e.dbId === t.id) })));

test('native presentation changes registry landings and selected guides without touching issue or test tables', () => {
  const f = fixture();
  const before = protectedState(f.w);
  const other = JSON.stringify(f.other);
  assert.ok(sync(f).applied);
  assert.equal(protectedState(f.w), before);
  assert.equal(JSON.stringify(f.other), other);
  assert.equal(f.w.getDoc(f.row.id), '# Keep my prose');
  assert.equal(intro(f).config.preview, 'intro');
  assert.equal(intro(f).config.multiple, false);
  assert.equal(f.w.bodyBlocks('Handbook/Guide')[0], 'Documentation introduction');
  const issue = f.w.getTable('Development/Issue');
  const landing = Object.values(f.w.state.entities).find(e => e.sysId === issue.id);
  assert.equal(landing.files.length, 2);
});

test('reruns preserve all record and attachment identities and create no activity', () => {
  const f = fixture();
  sync(f);
  const before = JSON.stringify(f.w.exportJSON({ fileBlobs: true }));
  assert.equal(sync(f).applied, false);
  assert.equal(JSON.stringify(f.w.exportJSON({ fileBlobs: true })), before);
});

test('source changes replace only the owned file and retain old and unrelated attachments', () => {
  const f = fixture();
  sync(f);
  const old = current(f);
  const mine = f.w.attachFile(f.row.id, { name: 'my-note.txt', bytes: Buffer.from('Mine') });
  f.presentation.guides[0].html = '<p>A revised introduction.</p>';
  assert.ok(sync(f).applied);
  assert.notEqual(current(f), old);
  const ids = f.w.getEntity(f.row.id).files.map(x => x.id);
  assert.ok(ids.includes(old));
  assert.ok(ids.includes(mine.id));
  assert.equal(f.w.getDoc(f.row.id), '# Keep my prose');
});

test('independent replacement and cleared slots are preserved and reported', () => {
  for (const clear of [false, true]) {
    const f = fixture();
    sync(f);
    const mine = clear ? [] : [f.w.attachFile(f.row.id, { name: 'mine.html', mime: 'text/html', bytes: Buffer.from('<p>Mine</p>') }).id];
    f.w.updateEntity(f.row.id, { [intro(f).name]: mine });
    f.presentation.guides[0].html = '<p>Source changed</p>';
    const result = sync(f);
    assert.ok(result.conflicts.some(x => x.includes('Start here')));
    assert.deepEqual(f.w.getEntity(f.row.id).values[intro(f).id], mine);
  }
});

test('ownership survives export/import and respects independently changed body order', () => {
  const f = fixture();
  sync(f);
  const restored = new Weave();
  restored.importJSON(f.w.exportJSON({ fileBlobs: true }));
  f.w = restored;
  assert.equal(sync(f).applied, false);
  f.w.updateTable('Handbook/Guide', { bodyOrder: ['@values', 'Documentation introduction', 'Description'] });
  const before = f.w.bodyBlocks('Handbook/Guide');
  sync(f);
  assert.deepEqual(f.w.bodyBlocks('Handbook/Guide'), before);
});

test('missing targets never create substitute spaces, tables or guides', () => {
  const f = fixture();
  f.presentation = { spaces: [{ name: 'Missing', bannerPath, html: '' }], tables: [{ name: 'Missing/Thing', bannerPath, html: '' }], guides: [{ name: 'Missing guide', bannerPath, html: '' }] };
  const before = JSON.stringify(f.w.exportJSON());
  assert.equal(sync(f).applied, false);
  assert.equal(JSON.stringify(f.w.exportJSON()), before);
});

test('field name collisions and deleted owned fields never get silently recreated', () => {
  const f = fixture();
  const t = f.w.getTable('Handbook/Guide');
  const mine = f.w.addField(t.id, { name: 'Documentation introduction', type: 'text' });
  f.w.updateEntity(f.row.id, { [mine.name]: 'My text' });
  assert.ok(sync(f).conflicts.some(x => x.includes('independently managed')));
  assert.equal(f.w.getEntity(f.row.id).values[mine.id], 'My text');
  const g = fixture();
  sync(g);
  g.w.deleteField('Handbook/Guide', intro(g).id);
  assert.ok(sync(g).conflicts.some(x => x.includes('removed')));
  assert.equal(intro(g), undefined);
});

test('managed descriptions fill empty values and preserve subsequent prose edits', () => {
  const f = fixture();
  f.presentation.spaces[0].description = 'Learn with real workspaces.';
  sync(f);
  const space = f.w.listSpaces().find(s => s.name === 'Handbook');
  assert.equal(space.description, 'Learn with real workspaces.');
  f.presentation.spaces[0].description = 'Learn and build.';
  sync(f);
  assert.equal(space.description, 'Learn and build.');
  f.w.updateSpace(space.id, { description: 'Our own introduction.' });
  f.presentation.spaces[0].description = 'A newer source introduction.';
  sync(f);
  assert.equal(space.description, 'Our own introduction.');
});

test('known legacy descriptions require an exact match and never relax protected schema preservation', () => {
  const f = fixture();
  const space = f.w.listSpaces().find(s => s.name === 'Handbook');
  f.w.updateSpace(space.id, { description: 'Old generated text' });
  f.presentation.spaces[0].previousDescription = 'Old generated text';
  f.presentation.spaces[0].description = 'Approved replacement';
  const before = protectedState(f.w);
  sync(f);
  assert.equal(space.description, 'Approved replacement');
  assert.equal(protectedState(f.w), before);
});

test('ambiguous guide titles do not assign presentation to an arbitrary record', () => {
  const f = fixture();
  f.w.createEntity('Handbook/Guide', { name: 'Start here', doc: '# Separate page' });
  sync(f);
  assert.equal(f.w.getEntity(f.row.id).files.length, 0);
});

test('a partially completed attachment write is preserved for review on the next sync', () => {
  const f = fixture();
  f.presentation.spaces = [];
  f.presentation.tables = [];
  const attach = f.w.attachToField.bind(f.w);
  f.w.attachToField = (...args) => { attach(...args); throw new Error('Interrupted'); };
  f.w.actor = 'reader';
  assert.throws(() => sync(f), /Interrupted/);
  assert.equal(f.w.actor, 'reader');
  f.w.attachToField = attach;
  const before = f.w.getEntity(f.row.id).files[0].id;
  const result = sync(f);
  assert.ok(result.conflicts.some(x => x.includes('attachment was edited')));
  assert.equal(f.w.getEntity(f.row.id).files[0].id, before);
});

test('a release introduction preserves the original notes, record identity and release relationships', () => {
  const f = fixture();
  const table = f.w.createTable({ space: 'Development', name: 'Release' });
  const release = f.w.createEntity(table, { name: 'v0.4.128', doc: '# Historical release notes\n\nOriginal evidence.' });
  const original = f.w.getDoc(release.id);
  f.presentation.releases = [{ name: 'v0.4.128', bannerPath, html: '<p>Read the changes.</p>' }];
  sync(f);
  assert.equal(f.w.getDoc(release.id), original);
  assert.equal(f.w.findEntity(table, 'v0.4.128').id, release.id);
  assert.equal(f.w.getEntity(release.id).files.length, 2);
  assert.equal(f.w.bodyBlocks(table)[0], 'Documentation introduction');
  assert.equal(sync(f).applied, false);
});
