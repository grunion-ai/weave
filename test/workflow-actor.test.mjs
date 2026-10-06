import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

/* Issue #674: a row an automation changed named the person as Modified By.
   On Net, moving Request #3 to Done over MCP let "Close out on Done" tick
   Resolved, and the grid and the activity log both credited "kyle via …"
   with the tick. Writes made inside an automation run now carry the
   automation as actor, spelled `workflow:<Workflows row id>` (the UI draws
   that string as the row's chip), and the automation-ran entry keeps the
   person whose write fired it, with detail.workflow naming the row. */

function demo() {
  const w = new Weave({ actor: 'kyle' });
  w.createSpace({ name: 'Workflow Demo' });
  const t = w.createTable({ space: 'Workflow Demo', name: 'Request' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done' }] } });
  w.addField(t.id, { name: 'Resolved', type: 'checkbox' });
  const auto = w.createAutomation(t.id, {
    name: 'Close out on Done',
    trigger: { type: 'state-changed', field: 'Status', toState: 'Done' },
    actions: [{ type: 'set-field', field: 'Resolved', value: true }, { type: 'append-doc', text: 'Closed.' }, { type: 'add-comment', text: 'Closed.' }],
  });
  return { w, t, auto };
}

test('an automation\'s writes carry workflow:<row id>; the person keeps the write that fired it', () => {
  const { w, t, auto } = demo();
  const req = w.createEntity(t.id, { Name: 'R' });
  w.setState(req.id, 'Status', 'Done');
  const e = w.getEntity(req.id);
  const actor = `workflow:${auto.id}`;
  assert.equal(e.modifiedBy, actor, 'Modified By is the automation');
  assert.equal(e.createdBy, 'kyle', 'Created By is untouched');
  const by = (kind, field) => e.activity.filter((a) => a.kind === kind && (!field || a.detail.field === field)).map((a) => a.actor);
  assert.deepEqual(by('state-changed', 'Status'), ['kyle'], 'the person moved it to Done');
  assert.deepEqual(by('field-updated', 'Resolved'), [actor], 'the automation ticked Resolved');
  const ran = e.activity.filter((a) => a.kind === 'automation-ran');
  assert.equal(ran.length, 1);
  assert.equal(ran[0].actor, 'kyle', 'automation-ran keeps the triggering person');
  assert.deepEqual(ran[0].detail, { name: 'Close out on Done', workflow: auto.id });
  assert.equal(w.actor, 'kyle', 'the engine\'s actor is restored after the run');
});

test('the actor is restored even when an action throws', () => {
  const { w, t } = demo();
  const people = w.createTable({ space: 'Workflow Demo', name: 'Person' });
  const kim = w.createEntity(people.id, { Name: 'Kim' });
  w.addRelation(t.id, { name: 'Owner', targetDb: people.id, cardinality: 'many-to-one' });
  w.createAutomation(t.id, { name: 'Assign Kim', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Owner', value: 'Kim' }] });
  w.deleteEntity(kim.id, { hard: true });
  w.createEntity(t.id, { Name: 'R' });
  assert.equal(w.actor, 'kyle');
});
