import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

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

test('a comment an automation adds is signed workflow:<row id>, and its Script stays author-free (Issue #684)', () => {
  const { w, t, auto } = demo();
  const req = w.createEntity(t.id, { Name: 'R' });
  w.setState(req.id, 'Status', 'Done');
  const comments = w.getEntity(req.id).comments;
  assert.deepEqual(comments.map((c) => [c.author, c.text]), [[`workflow:${auto.id}`, 'Closed.']]);
  assert.deepEqual(JSON.parse(w.readEntity(auto.id).docs.Script).actions[2], { type: 'add-comment', text: 'Closed.' });
  assert.equal(w.describeAutomations()[0].actions[2].type, 'add-comment');
});

test('an automation\'s append-doc logs a doc-appended entry, as a person\'s append does (Issue #686)', () => {
  const { w, t, auto } = demo();
  const req = w.createEntity(t.id, { Name: 'R' });
  w.setState(req.id, 'Status', 'Done');
  const e = w.getEntity(req.id);
  const appended = e.activity.filter((a) => a.kind === 'doc-appended');
  assert.equal(appended.length, 1, 'the document the rule wrote is in the feed');
  assert.equal(appended[0].actor, `workflow:${auto.id}`);
  assert.equal(appended[0].detail.field, 'Description',
    'and names the document, which is what the page pulses the cell by');
  assert.equal(appended[0].detail.prevLength, 0);
  assert.equal(appended[0].detail.length, 7);
  assert.equal(appended[0].detail.delta, 7);
  assert.equal(appended[0].detail.preview, 'Closed.');
  assert.equal(w.getDoc(req.id), 'Closed.');
  assert.ok(appended[0].seq < e.activity.filter((a) => a.kind === 'automation-ran')[0].seq,
    'the append is logged inside the run, before the run is');
});

test('the delta of an automation\'s append spans its own text, not the document (Issue #686)', () => {
  const { w, t } = demo();
  const req = w.createEntity(t.id, { Name: 'R' });
  w.setDoc(req.id, 'Opened by the customer.');
  w.setState(req.id, 'Status', 'Done');
  const appended = w.getEntity(req.id).activity.filter((a) => a.kind === 'doc-appended');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].detail.prevLength, 23);
  assert.equal(appended[0].detail.length, 32);
  assert.equal(appended[0].detail.delta, 9, 'the blank line and the text the rule added');
  assert.equal(w.getDoc(req.id), 'Opened by the customer.\n\nClosed.');
});

test('an add-comment action that names its own author keeps it', () => {
  const { w, t } = demo();
  w.createAutomation(t.id, { name: 'Bot note', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'hi', author: 'release-bot' }] });
  const req = w.createEntity(t.id, { Name: 'R' });
  assert.deepEqual(w.getEntity(req.id).comments.map((c) => c.author), ['release-bot']);
});
