import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('a formula can read the record number as PublicId', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Ten times', type: 'formula', config: { expression: 'PublicId * 10' } });
  const a = w.createEntity('Task', { Name: 'a' });
  const b = w.createEntity('Task', { Name: 'b' });
  assert.equal(w.readEntity(a.id).fields['Ten times'], a.publicId * 10);
  assert.equal(w.readEntity(b.id).fields['Ten times'], b.publicId * 10);
  assert.notEqual(a.publicId, b.publicId);
});
