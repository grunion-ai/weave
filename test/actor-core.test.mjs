import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/actor-core.js');
const A = globalThis.weaveActor;

test('a handle reads as a name', () => {
  assert.equal(A.displayName('kyle'), 'Kyle');
  assert.equal(A.displayName('ada.lovelace'), 'Ada Lovelace');
  assert.equal(A.displayName(''), '');
});

test('the three actor shapes, and nothing', () => {
  assert.deepEqual(A.parseActor('kyle'), { kind: 'person', handle: 'kyle', name: 'Kyle', via: null });
  const via = A.parseActor('kyle via VMH4hSRpVOhCwUno');
  assert.deepEqual(via, { kind: 'person', handle: 'kyle', name: 'Kyle', via: 'MCP' });
  assert.doesNotMatch(JSON.stringify(via), /VMH4hSRpVOhCwUno/, 'Issue #675: the client id never surfaces');
  assert.deepEqual(A.parseActor('mcp:claude-code'), { kind: 'person', handle: 'claude-code', name: 'Claude Code', via: 'MCP' });
  assert.deepEqual(A.parseActor('workflow:7d1da813-a75c'), { kind: 'workflow', workflowId: '7d1da813-a75c' });
  assert.deepEqual(A.parseActor(null), { kind: 'none' });
  assert.deepEqual(A.parseActor('  '), { kind: 'none' });
});

test('an actor as plain text: the name and its door, never a client id (Issue #675)', () => {
  assert.equal(A.actorText('kyle via VMH4hSRpVOhCwUno'), 'Kyle via MCP');
  assert.equal(A.actorText('kyle via MCP'), 'Kyle via MCP');
  assert.equal(A.actorText('kyle'), 'kyle', 'a plain author reads as written');
  assert.equal(A.actorText('workflow:7d1da813-a75c'), 'Automation', 'a rule never prints its row id');
  assert.equal(A.actorText(null), '');
});

const T = '2026-10-06T04:14:51.000Z';
const NOW = Date.parse(T);
const entry = (seq, kind, actor, detail = {}, ts = T) => ({ seq, kind, actor, detail, ts });

test('the run is the tail of automation entries, in action order, and the trigger is the person\'s', () => {
  const activity = [
    entry(1, 'created', 'kyle'),
    entry(2, 'state-changed', 'kyle', { field: 'Stage', from: 'Open', to: 'Done' }),
    entry(3, 'field-updated', 'workflow:wf1', { field: 'Resolved', from: null, to: true }),
    entry(4, 'doc-appended', 'workflow:wf1', { field: 'Description' }),
    entry(5, 'automation-ran', 'kyle', { name: 'Close out on Done', workflow: 'wf1' }),
  ];
  const run = A.automationWrites(activity, { now: NOW });
  assert.deepEqual(run.fields, ['Resolved', 'Description']);
  assert.deepEqual(run.runs, [{ name: 'Close out on Done', workflowId: 'wf1', fields: ['Resolved', 'Description'] }]);
  assert.equal(run.seq, 5);
});

test('a rule that changed nothing still ran: the automation-ran entry names its row', () => {
  const run = A.automationWrites([
    entry(1, 'state-changed', 'kyle', { field: 'Stage' }),
    entry(2, 'automation-ran', 'kyle', { name: 'Ping Slack', workflow: 'wf9' }),
  ], { now: NOW });
  assert.deepEqual(run.runs, [{ name: 'Ping Slack', workflowId: 'wf9', fields: [] }]);
  assert.deepEqual(run.fields, []);
});

test('two rules in one write are two runs, each with its own row', () => {
  const run = A.automationWrites([
    entry(1, 'state-changed', 'kyle', { field: 'Stage' }),
    entry(2, 'field-updated', 'workflow:a', { field: 'Resolved' }),
    entry(3, 'automation-ran', 'kyle', { name: 'First' }),
    entry(4, 'field-updated', 'workflow:b', { field: 'Owner' }),
    entry(5, 'field-updated', 'workflow:b', { field: 'Resolved' }),
    entry(6, 'automation-ran', 'kyle', { name: 'Second' }),
  ], { now: NOW });
  assert.deepEqual(run.runs.map((r) => [r.name, r.workflowId, r.fields]), [['First', 'a', ['Resolved']], ['Second', 'b', ['Owner', 'Resolved']]]);
  assert.deepEqual(run.fields, ['Resolved', 'Owner'], 'each field once, first write first');
});

test('nothing ran: a person\'s write, or an old run the write did not make', () => {
  assert.equal(A.automationWrites([entry(1, 'field-updated', 'kyle', { field: 'Name' })], { now: NOW }), null);
  assert.equal(A.automationWrites([], { now: NOW }), null);
  assert.equal(A.automationWrites(undefined), null);
  const at = '2026-10-06T04:00:00.000Z';
  const old = [
    entry(1, 'state-changed', 'kyle', { field: 'Stage' }, at),
    entry(2, 'field-updated', 'workflow:wf1', { field: 'Resolved' }, at),
    entry(3, 'automation-ran', 'kyle', { name: 'Close out on Done' }, at),
  ];
  assert.equal(A.automationWrites(old, { now: NOW }), null, 'a write that logged nothing does not replay the last run');
  old.push(entry(4, 'field-updated', 'kyle', { field: 'Name' }));
  assert.equal(A.automationWrites(old, { now: NOW }), null, 'a person\'s entry ends the tail');
});

test('writes with no automation-ran after them are still a run, unnamed', () => {
  const run = A.automationWrites([
    entry(1, 'state-changed', 'kyle', { field: 'Stage' }),
    entry(2, 'field-updated', 'workflow:wf1', { field: 'Resolved' }),
  ], { now: NOW });
  assert.deepEqual(run.runs, [{ name: null, workflowId: 'wf1', fields: ['Resolved'] }]);
});
