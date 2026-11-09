import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { TOOLS } from '../src/mcp.js';
import { createWorkspaceHub } from '../src/server.js';
await import('../public/starter-core.js');
const S = globalThis.WeaveStarters;

const isoDay = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');
const todays = () => { const d = new Date(); return [isoDay(d), d.toISOString().slice(0, 10)]; };

const STAMP = () => ({
  name: 'Stamp the done date',
  trigger: { type: 'state-changed', field: 'Status', toState: 'Done' },
  actions: [{ type: 'set-field', field: 'Done on', value: '{{Today:iso}}' }],
});

const SPEC = (rule = STAMP()) => ({
  spaces: [{
    name: 'Work',
    tables: [{
      name: 'Tasks',
      fields: [
        { name: 'Status', type: 'workflow', states: [
          { name: 'To do', category: 'not-started', default: true },
          { name: 'Done', category: 'done' },
        ] },
        { name: 'Done on', type: 'date' },
      ],
      rows: [{ Name: 'Seeded done', Status: 'Done' }, { Name: 'Open one' }],
      automations: [rule],
    }],
  }],
});

test('a table in a build spec takes automations by name, built On and Ready', () => {
  const w = new Weave();
  const r = w.build(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ignored, []);
  assert.equal(r.created.automations, 1);
  const [rule] = w.describeAutomations('Work/Tasks');
  assert.equal(rule.name, 'Stamp the done date');
  assert.equal(rule.enabled, true);
  assert.equal(rule.state, 'Ready');
  assert.deepEqual(rule.trigger, { type: 'state-changed', field: 'Status', toState: 'Done' });
  const t = w.getTable('Work/Tasks');
  assert.equal(w.readEntity(w.findEntity(t.id, 'Seeded done').id).raw['Done on'] ?? null, null, 'seeded rows land as the spec wrote them');
  const open = w.findEntity(t.id, 'Open one');
  w.updateEntity(open.id, { Status: 'Done' });
  assert.ok(todays().includes(w.readEntity(open.id).raw['Done on']), 'the rule stamps the done date');
});

test('dryRun reports a rule that would read Setup incomplete, with the reason, and writes nothing', () => {
  const w = new Weave();
  const before = w.listAutomations().length;
  const rule = { ...STAMP(), actions: [{ type: 'set-field', field: 'Finished', value: '{{Today:iso}}' }] };
  const r = w.build(SPEC(rule), { dryRun: true });
  assert.equal(r.ok, false);
  assert.equal(r.dryRun, true);
  const err = r.errors.find((e) => e.path === 'spaces[0].tables[0].automations[0]');
  assert.ok(err, JSON.stringify(r.errors));
  assert.match(err.error, /Stamp the done date/);
  assert.match(err.error, /Setup incomplete/);
  assert.match(err.error, /Finished/);
  assert.equal(w.findSpace('Work') ?? null, null, 'nothing written');
  assert.equal(w.listAutomations().length, before);
  const real = w.build(SPEC(rule));
  assert.equal(real.ok, false, 'the real run refuses the same spec');
  assert.equal(w.findSpace('Work') ?? null, null);
});

test('a rule written Off builds Off, and a dry run counts the rule it would make', () => {
  const w = new Weave();
  const dry = w.build(SPEC({ ...STAMP(), on: false }), { dryRun: true });
  assert.equal(dry.ok, true, JSON.stringify(dry.errors));
  assert.equal(dry.created.automations, 1);
  assert.equal(w.listAutomations().length, 0);
  w.build(SPEC({ ...STAMP(), on: false }));
  assert.equal(w.describeAutomations('Work/Tasks')[0].enabled, false);
});

test('a re-run keeps the rule of the same name, and unknown rule keys are listed as ignored', () => {
  const w = new Weave();
  w.build(SPEC());
  const again = w.build(SPEC({ ...STAMP(), colour: 'red' }), { skipExistingRows: true });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(again.created.automations ?? 0, 0);
  assert.ok(again.existing.includes('automation Work/Tasks: Stamp the done date'), JSON.stringify(again.existing));
  assert.deepEqual(again.ignored, [{ path: 'spaces[0].tables[0].automations[0]', keys: ['colour'] }]);
  assert.equal(w.listAutomations().length, 1);
});

test('a rule that is not an object, or names no actions, is an error at its path', () => {
  const w = new Weave();
  const r = w.build(SPEC('stamp it'), { dryRun: true });
  assert.ok(r.errors.some((e) => e.path === 'spaces[0].tables[0].automations[0]'), JSON.stringify(r.errors));
  const s = w.build(SPEC({ name: 'Nothing', trigger: { type: 'entity-created' } }), { dryRun: true });
  assert.ok(s.errors.some((e) => e.path === 'spaces[0].tables[0].automations[0]' && /action/.test(e.error)), JSON.stringify(s.errors));
});

test('a workspace under a hub builds its rule into the hub registry, and its dry run checks it the same way', () => {
  const root = new Weave({ name: 'root' });
  const alpha = new Weave({ name: 'alpha' });
  createWorkspaceHub(root, { workspaces: { alpha } });
  const dry = alpha.build(SPEC(), { dryRun: true });
  assert.equal(dry.ok, true, JSON.stringify(dry.errors));
  assert.equal(dry.created.automations, 1);
  const bad = alpha.build(SPEC({ ...STAMP(), trigger: { type: 'state-changed', field: 'Stage', toState: 'Done' } }), { dryRun: true });
  assert.match(bad.errors.map((e) => e.error).join(' '), /Setup incomplete.*Stage/);
  const r = alpha.build(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const [rule] = alpha.describeAutomations('Work/Tasks');
  assert.equal(rule.state, 'Ready');
  assert.equal(rule.enabled, true);
  assert.deepEqual(root.listAutomations().map((a) => a.name), [], 'the rule belongs to alpha, not the root');
});

test('weave_build documents automations on a table', () => {
  const tool = TOOLS.find((t) => t.name === 'weave_build');
  assert.match(JSON.stringify(tool), /automations/);
});

test('the Work starter ships one rule, built On, that stamps a done date when a task reaches Done', () => {
  const work = S.TEMPLATES.find((t) => t.id === 'tasks');
  const w = new Weave();
  const r = w.build(S.spec(work, { now: new Date() }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ignored, []);
  const rules = w.describeAutomations(`${work.space}/Tasks`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].enabled, true);
  assert.equal(rules[0].state, 'Ready');
  assert.equal(rules[0].trigger.toState, 'Done');
  const t = w.getTable(`${work.space}/Tasks`);
  const e = w.findEntity(t.id, 'Invite a teammate');
  const field = rules[0].actions[0].field;
  assert.equal(w.readEntity(e.id).raw[field] ?? null, null);
  w.updateEntity(e.id, { Status: 'Done' });
  assert.ok(todays().includes(w.readEntity(e.id).raw[field]), `${field} is stamped`);
});
