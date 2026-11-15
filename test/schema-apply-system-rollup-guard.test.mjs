import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const withSpaceRollup = () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('System/Spaces', { name: 'Task count', type: 'rollup', config: { via: 'Dev/Task', aggregate: 'count' } });
  return w;
};

const docWithoutRollup = (w) => {
  const doc = w.describeSchema();
  const spaces = doc.find((s) => s.system === 'workspace').tables.find((t) => t.system === 'spaces');
  assert.ok(spaces.fields.some((f) => f.name === 'Task count'), 'the registry document lists the rollup');
  spaces.fields = spaces.fields.filter((f) => f.name !== 'Task count');
  return doc;
};

const rollupNamed = (w) => Object.values(w.getTable('System/Spaces').fields).find((f) => f.name === 'Task count');

test('a document that drops a space rollup is refused without allowDestructive, naming the field', () => {
  const w = withSpaceRollup();
  const doc = docWithoutRollup(w);
  assert.throws(() => w.applySchema(doc), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, /delete 'System\/Spaces\.Task count'/);
    assert.match(err.message, /needs allowDestructive/);
    return true;
  });
  assert.ok(rollupNamed(w), 'the refused document changed nothing');
});

test('a dry run of that document refuses the same way and leaves the rollup', () => {
  const w = withSpaceRollup();
  assert.throws(() => w.applySchema(docWithoutRollup(w), { dryRun: true }), (err) => err.code === 'invalid' && /allowDestructive/.test(err.message));
  assert.ok(rollupNamed(w));
});

test('allowDestructive drops the space rollup and plans a delete-field', () => {
  const w = withSpaceRollup();
  const plan = w.applySchema(docWithoutRollup(w), { allowDestructive: true });
  assert.deepEqual(plan, [{ action: 'delete-field', subject: 'System/Spaces.Task count' }]);
  assert.equal(rollupNamed(w), undefined);
});

test('a partial document leaves space rollups it does not mention alone', () => {
  const w = withSpaceRollup();
  const plan = w.applySchema(docWithoutRollup(w), { partial: true });
  assert.deepEqual(plan, []);
  assert.ok(rollupNamed(w));
});
