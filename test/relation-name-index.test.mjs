import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function people(n = 0) {
  const w = new Weave();
  w.createSpace({ name: 'Crm' });
  const person = w.createTable({ space: 'Crm', name: 'Person' });
  const deal = w.createTable({ space: 'Crm', name: 'Deal' });
  w.addRelation(deal.id, { name: 'Owner', targetDb: person.id, cardinality: 'many-to-one' });
  for (let i = 0; i < n; i++) w.createEntity(person.id, { Name: `Person ${i}` });
  return { w, person, deal };
}

function nameReads(w) {
  const seen = { calls: 0 };
  const own = w.entityName.bind(w);
  w.entityName = (e) => { seen.calls++; return own(e); };
  return seen;
}

test('a relation value given by name finds the exact name first, then any case (Issue #1620)', () => {
  const { w, person } = people();
  const upper = w.createEntity(person.id, { Name: 'KIM' });
  const lower = w.createEntity(person.id, { Name: 'kim' });
  assert.equal(w.findEntity(person.id, 'kim').id, lower.id);
  assert.equal(w.findEntity(person.id, 'KIM').id, upper.id);
  assert.equal(w.findEntity(person.id, 'Kim').id, upper.id);
  assert.equal(w.findEntity(person.id, 'Lee'), undefined);
});

test('duplicate names resolve to the same first row as a table scan, through rename, trash, restore and undo (Issue #1620)', () => {
  const { w, person, deal } = people();
  const a = w.createEntity(person.id, { Name: 'Sam' });
  const b = w.createEntity(person.id, { Name: 'Sam' });
  const c = w.createEntity(person.id, { Name: 'Alex' });
  assert.equal(w.findEntity(person.id, 'Sam').id, a.id);
  w.updateEntity(a.id, { Name: 'Sammy' });
  assert.equal(w.findEntity(person.id, 'Sam').id, b.id);
  assert.equal(w.findEntity(person.id, 'Sammy').id, a.id);
  w.updateEntity(a.id, { Name: 'Sam' });
  assert.equal(w.findEntity(person.id, 'Sam').id, a.id, 'a renamed-back row keeps its table position');
  w.updateEntity(c.id, { Name: 'sam' });
  assert.equal(w.findEntity(person.id, 'sam').id, c.id);
  assert.equal(w.findEntity(person.id, 'SAM').id, a.id);
  w.deleteEntity(a.id);
  assert.equal(w.findEntity(person.id, 'Sam').id, b.id, 'a trashed row is skipped');
  w.restoreEntity(a.id);
  assert.equal(w.findEntity(person.id, 'Sam').id, a.id);
  assert.equal(w.findEntity(person.id, 'Alex'), undefined);
  w.updateEntity(c.id, { Name: 'Alex' });
  assert.equal(w.findEntity(person.id, 'Alex')?.id, c.id);
  w.undo();
  assert.equal(w.findEntity(person.id, 'Alex'), undefined, 'undo takes the name back out');
  assert.equal(w.findEntity(person.id, 'sam').id, c.id);
  w.updateEntity(c.id, { Name: 'Alex' });
  const d = w.createEntity(deal.id, { Name: 'Deal 1', Owner: 'alex' });
  const owner = Object.values(w.getTable(deal.id).fields).find((f) => f.name === 'Owner');
  assert.deepEqual([w.getEntity(d.id).values[owner.id]].flat(), [c.id]);
});

test('resolving names reads a handful of rows, not the whole target table (Issue #1620)', () => {
  const { w, person, deal } = people(5000);
  w.findEntity(person.id, 'Person 1');
  const seen = nameReads(w);
  for (let i = 0; i < 100; i++) assert.ok(w.findEntity(person.id, `person ${i * 37}`));
  assert.ok(seen.calls < 500, `100 name lookups read ${seen.calls} names in a 5,000-row table`);
  seen.calls = 0;
  const d = w.createEntity(deal.id, { Name: 'Deal', Owner: 'Person 4999' });
  w.updateEntity(d.id, { Owner: 'Person 17' });
  assert.ok(seen.calls < 200, `two relation writes by name read ${seen.calls} names`);
});
