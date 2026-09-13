import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { references } from '../src/formula.js';
import { startServer } from '../src/server.js';

/* A cycle used to resolve to null: the recursion guard gave up at depth 8 and
   the cell read the same as a legitimately empty one (Issue #283). A formula
   that closes a cycle inside its own table is now refused when it is saved,
   and a cycle that only closes through a rollup or a lookup — which no save
   can see, since the loop needs two rows — reads `#CYCLE:` with the path. */

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  return { w, t };
}

test('references lists every field a formula reads, both branches included', () => {
  assert.deepEqual(references('Amount * 2'), ['Amount']);
  assert.deepEqual(references('if(Amount > 1, [Bonus], [Penalty])'), ['Amount', 'Bonus', 'Penalty']);
  assert.deepEqual(references('Amount and Amount'), ['Amount'], 'a name is listed once');
  assert.deepEqual(references('1 +'), [], 'a broken expression reports no dependency, not a throw');
});

test('updateField refuses a formula that closes a cycle, naming the path', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'Bonus', type: 'formula', config: { expression: 'Amount * 2' } });
  const total = w.addField(t.id, { name: 'Total', type: 'formula', config: { expression: 'Bonus + 1' } });
  assert.throws(
    () => w.updateField(t.id, 'Bonus', { config: { expression: 'Total + 1' } }),
    /cycle: Bonus → Total → Bonus/,
  );
  // The refusal left the field alone: the old expression still computes.
  const e = w.createEntity(t.id, { Name: 'Acme', Amount: 10 });
  assert.equal(w.resolveField(w.getEntity(e.id), 'Bonus'), 20);
  assert.equal(w.resolveField(w.getEntity(e.id), 'Total'), 21);
  assert.equal(w.getField(t.id, total.id).config.expression, 'Bonus + 1');
});

test('addField refuses a formula that closes a cycle a dropped field left open', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'Total', type: 'text' });
  w.addField(t.id, { name: 'Bonus', type: 'formula', config: { expression: 'Total + 1' } });
  w.deleteField(t.id, 'Total');
  // Bonus still names 'Total'; adding a formula under that name closes the loop.
  assert.throws(
    () => w.addField(t.id, { name: 'Total', type: 'formula', config: { expression: 'Bonus + 1' } }),
    /cycle: Total → Bonus → Total/,
  );
  const plain = w.addField(t.id, { name: 'Total', type: 'number' });
  assert.equal(plain.type, 'number', 'a non-formula field under the same name is fine');
});

test('a type change into a formula is refused when it closes a cycle', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'Total', type: 'text' });
  w.addField(t.id, { name: 'Bonus', type: 'formula', config: { expression: 'Total + 1' } });
  assert.throws(
    () => w.updateField(t.id, 'Total', { type: 'formula', config: { expression: 'Bonus + 1' } }),
    /cycle: Total → Bonus → Total/,
  );
  assert.equal(w.getField(t.id, 'Total').type, 'text', 'the refused migration left the type alone');
  w.updateField(t.id, 'Total', { type: 'formula', config: { expression: 'Amount * 3' } });
  const e = w.createEntity(t.id, { Name: 'Acme', Amount: 2 });
  assert.equal(w.resolveField(w.getEntity(e.id), 'Total'), 6, 'an acyclic migration still lands');
});

test('a deep but acyclic formula chain still computes', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'A', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(t.id, { name: 'B', type: 'formula', config: { expression: 'A + 1' } });
  w.addField(t.id, { name: 'C', type: 'formula', config: { expression: 'B + 1' } });
  const e = w.createEntity(t.id, { Name: 'Acme', Amount: 5 });
  assert.equal(w.resolveField(w.getEntity(e.id), 'C'), 12);
});

test('checkFormula reports the cycle instead of previewing a wrong number', () => {
  const { w, t } = seeded();
  w.addField(t.id, { name: 'Bonus', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(t.id, { name: 'Total', type: 'formula', config: { expression: 'Bonus + 1' } });
  w.createEntity(t.id, { Name: 'Acme', Amount: 10 });
  const verdict = w.checkFormula(t.id, 'Total + 1', { excludeField: 'Bonus' });
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /cycle: Bonus → Total → Bonus/);
  assert.equal(w.checkFormula(t.id, 'Amount + 1', { excludeField: 'Bonus' }).ok, true);
});

/* The loop that no save-time check can see: it runs through a rollup, so it
   only exists once two rows point at each other. */
function linkedPair() {
  const { w, t } = seeded();
  w.addRelation(t.id, { name: 'Peer', targetDb: t.id, cardinality: 'many-to-many', inverseName: 'PeerOf' });
  w.addField(t.id, { name: 'Double', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(t.id, { name: 'PeerSum', type: 'rollup', config: { relationField: 'Peer', targetField: 'Double', aggregate: 'sum' } });
  w.updateField(t.id, 'Double', { config: { expression: 'Amount + PeerSum' } });
  const a = w.createEntity(t.id, { Name: 'A', Amount: 1 });
  const b = w.createEntity(t.id, { Name: 'B', Amount: 2 });
  w.updateEntity(a.id, { Peer: [b.id] });
  w.updateEntity(b.id, { Peer: [a.id] });
  return { w, t, a, b };
}

test('a cycle through a rollup reads #CYCLE with its path, not null', () => {
  const { w, a } = linkedPair();
  const v = w.resolveField(w.getEntity(a.id), 'Double');
  assert.match(String(v), /^#CYCLE: /, `expected a cycle marker, got ${JSON.stringify(v)}`);
  // The loop travels between two rows, so the path names both.
  assert.equal(v, '#CYCLE: A › Double → A › PeerSum → B › Double → B › PeerSum → A › Double');
});

test('a loop that stays on one row names fields alone', () => {
  const { w, t } = seeded();
  w.addRelation(t.id, { name: 'Mirror', targetDb: t.id, cardinality: 'many-to-many', inverseName: 'MirrorOf' });
  w.addField(t.id, { name: 'Double', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(t.id, { name: 'MirrorSum', type: 'rollup', config: { relationField: 'Mirror', targetField: 'Double', aggregate: 'sum' } });
  w.updateField(t.id, 'Double', { config: { expression: 'Amount + MirrorSum' } });
  const a = w.createEntity(t.id, { Name: 'A', Amount: 1 });
  w.updateEntity(a.id, { Mirror: [a.id] });
  assert.equal(w.resolveField(w.getEntity(a.id), 'Double'), '#CYCLE: Double → MirrorSum → Double');
});

test('the marker reaches the row read and the grid cell, not just the resolver', () => {
  const { w, a } = linkedPair();
  const row = w.readEntity(a.id);
  assert.match(String(row.fields.Double), /^#CYCLE: /);
  assert.match(String(row.fields.PeerSum), /^#CYCLE: /, 'the rollup reports the cycle rather than summing NaN');
});

test('a row outside the loop keeps computing', () => {
  const { w, t } = linkedPair();
  const lone = w.createEntity(t.id, { Name: 'Lone', Amount: 7 });
  assert.equal(w.resolveField(w.getEntity(lone.id), 'Double'), 7, 'no peers, no cycle');
});

test('the stack unwinds: a cycle read does not poison the next read', () => {
  const { w, t, a } = linkedPair();
  assert.match(String(w.resolveField(w.getEntity(a.id), 'Double')), /^#CYCLE: /);
  const lone = w.createEntity(t.id, { Name: 'Lone', Amount: 4 });
  assert.equal(w.resolveField(w.getEntity(lone.id), 'Double'), 4);
  assert.match(String(w.resolveField(w.getEntity(a.id), 'Double')), /^#CYCLE: /, 'still detected the second time');
});

test('REST refuses the cycling formula with 400 and the path', async () => {
  const weave = new Weave();
  const { server } = await startServer(weave, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  try {
    await api('POST', '/api/spaces', { name: 'Sales' });
    await api('POST', '/api/tables', { space: 'Sales', name: 'Deals' });
    await api('POST', '/api/tables/Deals/fields', { name: 'Amount', type: 'number' });
    await api('POST', '/api/tables/Deals/fields', { name: 'Bonus', type: 'formula', config: { expression: 'Amount * 2' } });
    await api('POST', '/api/tables/Deals/fields', { name: 'Total', type: 'formula', config: { expression: 'Bonus + 1' } });
    const res = await api('PATCH', '/api/tables/Deals/fields/Bonus', { config: { expression: 'Total + 1' } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /cycle: Bonus → Total → Bonus/);
  } finally {
    server.close();
  }
});
