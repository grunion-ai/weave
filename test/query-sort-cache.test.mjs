import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const owner = w.createTable({ space: 'Sales', name: 'Owner' });
  w.addField(owner.id, { name: 'Score', type: 'number' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(deal.id, { name: 'Amount', type: 'number' });
  w.addField(deal.id, { name: 'Due', type: 'date' });
  w.addField(deal.id, { name: 'Stage', type: 'select', config: { options: ['Open', 'Won', 'Lost'] } });
  w.addRelation(deal.id, { name: 'Owner', targetDb: owner.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(owner.id, { name: 'Spend', type: 'rollup', config: { relationField: 'Deals', targetField: 'Amount', aggregate: 'sum' } });
  w.addField(deal.id, { name: 'Owner name', type: 'lookup', config: { relationField: 'Owner', targetField: 'Name' } });
  w.addField(deal.id, { name: 'Owner spend', type: 'lookup', config: { relationField: 'Owner', targetField: 'Spend' } });
  const owners = ['Maya', 'Ari', 'Zed', 'Bea'].map((name, i) => w.createEntity(owner.id, { name, values: { Score: [3, null, 3, 1][i] } }));
  const amounts = [50, null, 50, 10, 70, null, 10, 90];
  const stages = ['Won', 'Open', null, 'Lost', 'Won', 'Open', 'Lost', null];
  const dues = ['2026-03-01', null, '2026-01-15', '2026-03-01', null, '2025-12-31', '2026-02-02', '2026-01-15'];
  const deals = amounts.map((Amount, i) => w.createEntity(deal.id, {
    name: `Deal ${i}`,
    values: { Amount, Due: dues[i], Stage: stages[i], Owner: i === 5 ? null : owners[i % owners.length].id },
  }));
  w.deleteEntity(deals[2].id);
  w.deleteEntity(deals[6].id);
  return { w, owner, deal, owners, deals };
}

const SORTS = ['Amount', 'Due', 'Stage', 'Owner name', 'Owner spend', 'Owner', 'Name', 'Created By', 'publicId'];
const SHAPES = [
  {}, { includeDeleted: true }, { relations: 'chip' }, { select: ['Name', 'Amount'] }, { offset: 2, limit: 3 },
  { where: [['Stage', '!=', 'Lost']] },
  { where: { or: [['Amount', '>=', 50], ['Owner', 'is-empty']] }, includeDeleted: true },
  { where: [['Owner name', 'contains', 'a'], ['Due', 'not-empty']] },
  { where: [['Owner spend', '<', 100]] },
];

function every(w, dbId) {
  const out = {};
  for (const field of SORTS) {
    for (const dir of ['asc', 'desc']) {
      for (const shape of SHAPES) {
        const key = JSON.stringify([field, dir, shape]);
        out[key] = JSON.stringify(w.query(dbId, { ...shape, sort: [{ field, dir }] }));
      }
    }
  }
  out.twoKeys = JSON.stringify(w.query(dbId, { sort: [{ field: 'Stage', dir: 'asc' }, { field: 'Amount', dir: 'desc' }], includeDeleted: true }));
  return out;
}

function fresh(w) {
  const copy = new Weave();
  copy.importJSON(w.exportJSON({ blobs: false }));
  return copy;
}

test('a cached sort key answers byte for byte what the uncached path answered (Issue #1093)', () => {
  const { w, deal } = seeded();
  const cold = every(w, deal.id);
  const warm = every(w, deal.id);
  assert.deepEqual(warm, cold);
  assert.ok(Object.keys(cold).length > 100);
});

test('nulls sort last in both directions and ties keep creation order (Issue #1093)', () => {
  const { w, deal, deals } = seeded();
  const ids = (opts) => w.query(deal.id, opts).items.map((e) => deals.findIndex((d) => d.id === e.id));
  for (let pass = 0; pass < 2; pass++) {
    assert.deepEqual(ids({ sort: [{ field: 'Amount', dir: 'asc' }] }), [3, 0, 4, 7, 1, 5]);
    assert.deepEqual(ids({ sort: [{ field: 'Amount', dir: 'desc' }] }), [7, 4, 0, 3, 1, 5]);
    assert.deepEqual(ids({ sort: [{ field: 'Amount', dir: 'asc' }], includeDeleted: true }), [3, 6, 0, 2, 4, 7, 1, 5]);
    assert.deepEqual(ids({ sort: [{ field: 'Owner name', dir: 'asc' }] }), [1, 3, 7, 0, 4, 5]);
  }
});

test('every write drops the cached sort keys so the next page sorts on fresh values (Issue #1093)', () => {
  const { w, owner, deal, owners, deals } = seeded();
  const check = (label) => {
    const expected = every(fresh(w), deal.id);
    const seen = every(w, deal.id);
    for (const key of Object.keys(expected)) assert.equal(seen[key], expected[key], `${label}: ${key}`);
  };
  every(w, deal.id);
  w.updateEntity(deals[3].id, { Amount: 500 });
  check('after a value edit');
  w.updateEntity(owners[1].id, { Name: 'Quinn', Score: 9 });
  check('after an edit on the related row that the lookup and the rollup read');
  w.updateEntity(deals[0].id, { Owner: owners[2].id });
  check('after relinking a relation');
  w.deleteEntity(deals[4].id);
  check('after trashing a row');
  w.restoreEntity(deals[2].id);
  check('after restoring a row');
  w.updateField(deal.id, 'Stage', { config: { options: ['Lost', 'Won', 'Open'] } });
  check('after reordering select options');
  w.createEntity(deal.id, { name: 'Deal 8', values: { Amount: 1, Stage: 'Won', Owner: owners[3].id } });
  check('after creating a row');
  w.undo();
  check('after undo');
  w.deleteEntity(deals[1].id, { hard: true });
  check('after a hard delete');
  w.deleteTable(owner.id);
  check('after trashing the related table');
});

test('an unknown sort field or where operator still refuses the query (Issue #1093)', () => {
  const { w, deal } = seeded();
  for (let pass = 0; pass < 2; pass++) {
    assert.throws(() => w.query(deal.id, { sort: ['Nope'] }), /not found/);
    assert.throws(() => w.query(deal.id, { where: [['Amount', '~', 1]] }), /Unknown operator/);
  }
});

test('the live row count follows every write (Issue #1093)', () => {
  const { w, deal, deals } = seeded();
  const count = () => w.describeSchema().flatMap((s) => s.tables).find((t) => t.id === deal.id).entityCount;
  assert.equal(count(), 6);
  w.deleteEntity(deals[0].id);
  assert.equal(count(), 5);
  w.restoreEntity(deals[0].id);
  assert.equal(count(), 6);
  w.createEntity(deal.id, { name: 'Deal 8' });
  assert.equal(count(), 7);
  w.undo();
  assert.equal(count(), 6);
  w.deleteEntity(deals[1].id, { hard: true });
  assert.equal(count(), 5);
  const copy = fresh(w);
  assert.equal(copy.describeSchema().flatMap((s) => s.tables).find((t) => t.id === deal.id).entityCount, 5);
});
