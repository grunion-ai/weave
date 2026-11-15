import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('a chip shows the colour of the option the record holds, not of another option', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Tone', type: 'select', config: { options: [{ name: 'Red', hue: 'red' }, { name: 'Blue', hue: 'blue' }] } });
  const e = w.createEntity('Task', { Name: 'x', Tone: 'Blue' });
  const seg = w.renderView(e.id, 'chip').fields.find((f) => f.label === 'Tone');
  assert.equal(seg.value, 'Blue');
  assert.deepEqual(seg.option, { name: 'Blue', hue: 'blue' });
});
