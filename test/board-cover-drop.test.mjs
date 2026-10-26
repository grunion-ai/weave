import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import '../public/board-core.js';

const Board = globalThis.weaveBoardCore;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

const cover = { name: 'Photo', type: 'attachments', preview: 'cover', multiple: false };
const db = (fields = [cover], extra = {}) => ({ name: 'Shopping List', fields, ...extra });

test('a second upload into a single-file field replaces its file and keeps the old one on the row', () => {
  const w = new Weave();
  w.createSpace({ name: 'Buyer' });
  const list = w.createTable({ space: 'Buyer', name: 'Shopping List' });
  w.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover' } });
  w.addField(list.id, { name: 'Files', type: 'attachments' });
  const desk = w.createEntity(list.id, { name: 'Standing desk' });
  const first = w.attachToField(desk.id, 'Photo', { name: 'a.png', mime: 'image/png', bytes: PNG });
  const second = w.attachToField(desk.id, 'Photo', { name: 'b.png', mime: 'image/png', bytes: PNG });
  const e = w.readEntity(desk.id);
  assert.deepEqual(e.raw.Photo, [second.id], 'the field holds the new file only');
  assert.ok(e.files.some((f) => f.id === first.id), 'the old file stays in the row ledger');
  w.attachToField(desk.id, 'Files', { name: 'x.txt', mime: 'text/plain', bytes: Buffer.from('x') });
  w.attachToField(desk.id, 'Files', { name: 'y.txt', mime: 'text/plain', bytes: Buffer.from('y') });
  assert.equal(w.readEntity(desk.id).raw.Files.length, 2, 'a many-file field still appends');
});

test('coverDrop picks the first picture a drop carries, read from a browser File type', () => {
  const files = [{ name: 'notes.txt', type: 'text/plain' }, { name: 'desk.png', type: 'image/png' }, { name: 'b.jpg', type: 'image/jpeg' }];
  const got = Board.coverDrop(db(), files);
  assert.equal(got.field.name, 'Photo');
  assert.equal(got.file.name, 'desk.png');
  assert.equal(got.refuse, undefined);
});

test('coverDrop refuses a drop with no picture and names the file', () => {
  assert.deepEqual(Board.coverDrop(db(), [{ name: 'quote.pdf', type: 'application/pdf' }]), { refuse: 'not-picture', name: 'quote.pdf' });
  assert.deepEqual(Board.coverDrop(db(), [{ name: 'art.svg', type: 'image/svg+xml' }]), { refuse: 'not-picture', name: 'art.svg' }, 'a cover draws PNG, JPEG, GIF or WebP only');
  assert.deepEqual(Board.coverDrop(db(), []), { refuse: 'not-picture', name: '' });
});

test('coverDrop asks for a cover field when the table has none, a hidden one, or only a many-file field', () => {
  const png = { name: 'a.png', type: 'image/png' };
  assert.deepEqual(Board.coverDrop(db([]), [png]), { refuse: 'no-field', file: png }, 'the picture rides along for the field to be added');
  assert.equal(Board.coverDrop(db([cover], { hiddenFields: ['Photo'] }), [png]).refuse, 'no-field');
  assert.equal(Board.coverDrop(db([{ name: 'Files', type: 'attachments' }]), [png]).refuse, 'no-field');
  assert.deepEqual(Board.coverDrop(db([]), [{ name: 'a.txt', type: 'text/plain' }]), { refuse: 'not-picture', name: 'a.txt' }, 'a file that is no picture is refused before the missing field');
});

test('photoFieldName finds a free name for the new cover field', () => {
  assert.equal(Board.photoFieldName(db([])), 'Photo');
  assert.equal(Board.photoFieldName(db([{ name: 'Photo', type: 'text' }])), 'Photo 2');
  assert.equal(Board.photoFieldName(db([{ name: 'Photo', type: 'text' }, { name: 'photo 2', type: 'text' }])), 'Photo 3');
});

test('freeFieldName finds a free name from any base', () => {
  assert.equal(Board.freeFieldName(db([]), 'Files'), 'Files');
  assert.equal(Board.freeFieldName(db([{ name: 'files', type: 'text' }]), 'Files'), 'Files 2');
  assert.equal(Board.photoFieldName(db([{ name: 'Photo', type: 'text' }])), 'Photo 2', 'the cover field keeps its own base');
});
