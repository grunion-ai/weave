import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('the outline marks a lookup whose relation is gone with question marks', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const a = w.createTable({ space: 'S', name: 'A' });
  const b = w.createTable({ space: 'S', name: 'B' });
  w.addField(b, { name: 'Date', type: 'text' });
  w.addRelation(a, { name: 'Rel', targetDb: b, cardinality: 'many-to-one', inverseName: 'As' });
  w.addField(a, { name: 'D', type: 'lookup', config: { relationField: 'Rel', targetField: 'Date' } });
  const relId = w.getField(a, 'Rel').id;
  const broken = JSON.parse(JSON.stringify(w.exportJSON()).replaceAll(`"relationField":"${relId}"`, '"relationField":"gone"'));
  const w2 = new Weave();
  w2.importJSON(broken);
  assert.match(w2.ontology(), /^ {2}A: .*; D = \?\.\?$/m);
});
