import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { stripEmptyEmbeds } from '../src/markdown.js';

const LEAK = '![Trip wishlist — flights, hotels, the lot.png]()';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Wiki' });
  w.createTable({ space: 'Wiki', name: 'Article' });
  w.addField('Article', { name: 'Spec', type: 'document' });
  return w;
}

test('an image embed with an empty source is dropped, and its alt text with it', () => {
  assert.equal(stripEmptyEmbeds(`before\n${LEAK}\nafter`), 'before\n\nafter');
  assert.equal(stripEmptyEmbeds('![]()'), '');
  assert.equal(stripEmptyEmbeds('![alt](   )'), '');
  assert.equal(stripEmptyEmbeds(`a ${LEAK} b`), 'a  b');
});

test('an embed that has a source is left alone', () => {
  const kept = '![](/api/files/0191c0de-dead-beef-cafe-000000000001)';
  assert.equal(stripEmptyEmbeds(kept), kept);
  assert.equal(stripEmptyEmbeds('![a photo](https://example.com/a.png)'), '![a photo](https://example.com/a.png)');
});

test('a link with an empty target is not an image embed and stays', () => {
  assert.equal(stripEmptyEmbeds('[not an image]()'), '[not an image]()');
});

test('an embed written as an example survives in a code fence and in inline code', () => {
  const fenced = '```md\n![alt]()\n```';
  assert.equal(stripEmptyEmbeds(fenced), fenced);
  assert.equal(stripEmptyEmbeds('type `![alt]()` to start an image'), 'type `![alt]()` to start an image');
  assert.equal(stripEmptyEmbeds('```\n![a]()\n```\n' + LEAK), '```\n![a]()\n```\n');
});

test('an escaped bang is literal text, not an embed', () => {
  assert.equal(stripEmptyEmbeds('\\![alt]()'), '\\![alt]()');
});

test('nothing with an empty source is saved, by any document write path', () => {
  const w = build();
  const created = w.createEntity('Article', { Name: 'Quickstart', doc: `intro\n${LEAK}\n` });
  assert.equal(w.getDoc(created.id).includes(LEAK), false, 'createEntity doc');
  assert.ok(w.getDoc(created.id).includes('intro'), 'the prose around it is kept');

  const byDocs = w.createEntity('Article', { Name: 'Second', docs: { Spec: LEAK } });
  assert.equal(w.getDoc(byDocs.id, 'Spec'), '', 'createEntity docs');

  w.setDoc(created.id, `written\n${LEAK}`, 'Spec');
  assert.equal(w.getDoc(created.id, 'Spec'), 'written\n', 'setDoc');

  w.appendDoc(created.id, LEAK, 'Spec');
  assert.equal(w.getDoc(created.id, 'Spec').includes(LEAK), false, 'appendDoc');

  w.updateEntity(created.id, { Spec: `patched\n${LEAK}` });
  assert.equal(w.getDoc(created.id, 'Spec').includes(LEAK), false, 'updateEntity');
  assert.ok(w.getDoc(created.id, 'Spec').includes('patched'), 'the prose around it is kept');
});

test('a document that gains only an empty embed is not recorded as a change', () => {
  const w = build();
  const e = w.createEntity('Article', { Name: 'Quiet', docs: { Spec: 'settled\n' } });
  const before = w.readEntity(e.id).updatedAt;
  w.setDoc(e.id, `settled\n${LEAK}`, 'Spec');
  assert.equal(w.getDoc(e.id, 'Spec'), 'settled\n', 'the stored text is untouched');
  assert.equal(w.readEntity(e.id).updatedAt, before, 'and the row is not stamped as edited');
});

test('an automation cannot append an empty embed either', () => {
  const w = build();
  w.createAutomation('Article', {
    name: 'Stamp', trigger: { type: 'entity-created' },
    actions: [{ type: 'append-doc', text: `stamped\n${LEAK}` }],
  });
  const e = w.createEntity('Article', { Name: 'Triggered' });
  const doc = w.getDoc(e.id);
  assert.equal(doc.includes(LEAK), false, 'the automation append is guarded too');
  assert.ok(doc.includes('stamped'), 'the rest of the template lands');
});
