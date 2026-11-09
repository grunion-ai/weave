import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const wf = (w) => w.getTable('System/Workflows');
const row = (w, id) => w.readEntity(id).fields;

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Notes', type: 'text' });
  return { w, t };
}

test('a Setup incomplete row that is Off carries the reason its toggle is locked, and drops it once setup is complete (Feature #249)', () => {
  const { w } = demo();
  const r = w.createEntity(wf(w).id, { Name: 'Half built' });
  w.setDoc(r.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'field-updated', field: 'Nope' }, actions: [{ type: 'add-comment', text: 'x' }] }), 'Script');
  let f = row(w, r.id);
  assert.equal(f.On, false);
  assert.equal(f.State, 'Setup incomplete');
  assert.equal(f.Health, 'No runs', 'an Off row has not failed: it has not run');
  assert.match(f['Health Reason'], /^Setup incomplete: .*Nope/, 'the reason names what is missing');
  w.setDoc(r.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'field-updated', field: 'Notes' }, actions: [{ type: 'add-comment', text: 'x' }] }), 'Script');
  f = row(w, r.id);
  assert.equal(f.State, 'Ready');
  assert.equal(f.Health, 'No runs');
  assert.equal(f['Health Reason'], null);
});

test('a row that breaks while On, then is switched Off, keeps the setup reason its toggle is now locked by (Feature #249)', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, { name: 'Note it', trigger: { type: 'field-updated', field: 'Notes' }, actions: [{ type: 'add-comment', text: 'x' }] });
  w.deleteField(t.id, 'Notes');
  w.updateEntity(auto.id, { On: false });
  const f = row(w, auto.id);
  assert.equal(f.On, false);
  assert.equal(f.State, 'Setup incomplete');
  assert.match(f['Health Reason'], /^Setup incomplete: .*Notes/);
  assert.throws(() => w.updateEntity(auto.id, { On: true }), /Notes/, 'and On stays refused until setup is complete');
});
