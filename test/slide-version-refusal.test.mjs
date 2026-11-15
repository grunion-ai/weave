import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { newSlideVersion } from '../src/deck.js';

test('versioning a record of a table that is not a slide table is refused as invalid', () => {
  const w = new Weave();
  w.createSpace({ name: 'Notes' });
  const note = w.createTable({ space: 'Notes', name: 'Note' });
  const row = w.createEntity(note.id, { name: 'Plain row' });
  assert.throws(() => newSlideVersion(w, row.id), (err) => err.code === 'invalid' && /not a slide/.test(err.message));
});
