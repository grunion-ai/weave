import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/setup-core.js');
const { begin, reduce, railState, STEPS } = globalThis.WeaveSetup;

const WS = { kind: 'workspace', name: 'acme' };
const INVITE = { kind: 'invite', name: 'acme' };
const PEOPLE = {
  stranger: { signedIn: false },
  newcomer: { signedIn: true, rows: [], canCreate: true, accountName: 'Ada' },
  closed: { signedIn: true, rows: [], canCreate: false },
  invited: { signedIn: true, rows: [INVITE], canCreate: false },
  returning: { signedIn: true, rows: [WS], canCreate: true, accountName: 'Ada' },
  returningClosed: { signedIn: true, rows: [WS], canCreate: false },
};
const QUERIES = [{}, { setup: 'skip' }, { setup: 'new' }, { error: 'signin_failed' }, { error: 'provider_down' }, { error: 'nonsense' }];
const EVENTS = [
  { type: 'new' }, { type: 'next', name: 'Harbor', slug: 'harbor', template: 'crm' }, { type: 'back' }, { type: 'skip' },
  { type: 'tool', tool: 'claude' }, { type: 'connected', at: 'now' }, { type: 'dismiss' },
  { type: 'built', made: { name: 'harbor' } }, { type: 'built', made: { name: 'harbor', templateError: 'boom' } },
  { type: 'fail', code: 'slug_taken' }, { type: 'fail', code: 'network' },
];
const key = (s) => JSON.stringify([s.step, s.skipped, !!s.connected, s.data.tool, s.error?.code ?? null, !!s.made, s.skippedAgent ?? false]);

function explore(me, query) {
  const start = begin(me, query);
  const seen = new Map([[key(start), { state: start, path: [] }]]);
  const queue = [seen.get(key(start))];
  while (queue.length) {
    const { state, path } = queue.shift();
    for (const e of EVENTS) {
      const next = reduce(state, e);
      const k = key(next);
      if (!seen.has(k) && path.length < 12) {
        const hit = { state: next, path: [...path, e.type + (e.code ? `:${e.code}` : '')] };
        seen.set(k, hit);
        queue.push(hit);
      }
    }
  }
  return [...seen.values()];
}

const ALL = Object.entries(PEOPLE).flatMap(([who, me]) => QUERIES.map((q) => ({ who, q, me, reached: explore(me, q) })));

test('begin: each kind of person lands on the step their sign-in allows', () => {
  const at = (who, q = {}) => begin(PEOPLE[who], q).step;
  assert.equal(at('stranger'), 'account');
  assert.equal(at('newcomer'), 'workspace');
  assert.equal(at('closed'), 'closed');
  assert.equal(at('invited'), 'list');
  assert.equal(at('returning'), 'list');
  assert.equal(at('returning', { setup: 'new' }), 'workspace');
  assert.equal(at('returningClosed', { setup: 'new' }), 'list');
  assert.equal(at('newcomer', { setup: 'skip' }), 'build', 'skip bypasses the managed steps');
  assert.equal(at('returning', { setup: 'skip' }), 'list', 'skip never makes a second workspace for someone who has one');
  assert.equal(at('closed', { setup: 'skip' }), 'closed', 'skip cannot create where sign-up is closed');
  assert.equal(begin(PEOPLE.stranger, { error: 'signin_failed' }).error.code, 'signin_failed');
  assert.equal(begin(PEOPLE.stranger, { error: 'nonsense' }).error, null, 'an unknown error code is not shown');
  assert.equal(begin(PEOPLE.newcomer).data.name, 'Ada', 'the name starts from the account');
});

test('every permutation: each reachable step is a known step with a way forward', () => {
  let states = 0;
  for (const { who, q, reached } of ALL) {
    for (const { state, path } of reached) {
      states++;
      const where = `${who} ${JSON.stringify(q)} after ${path.join(' > ') || 'start'}`;
      assert.ok(STEPS.includes(state.step), `${where}: unknown step ${state.step}`);
      if (['done', 'account', 'closed', 'list', 'build'].includes(state.step)) continue;
      const forward = ['next', 'skip'].some((type) => reduce(state, { type, name: 'n', slug: 'n' }).step !== state.step)
        || (state.step === 'agent' && reduce(reduce(state, { type: 'connected' }), { type: 'next' }).step === 'done');
      assert.ok(forward, `${where}: ${state.step} has no way forward`);
    }
  }
  assert.ok(states > 100, `explored ${states} states`);
});

test('every permutation: skip from any managed step finishes setup without a template or an agent', () => {
  for (const { who, q, reached } of ALL) {
    for (const { state, path } of reached.filter((r) => ['workspace', 'work'].includes(r.state.step))) {
      const skipped = reduce(state, { type: 'skip' });
      assert.equal(skipped.step, 'build', `${who} ${path.join('>')}`);
      assert.equal(reduce(skipped, { type: 'built', made: { name: 'x' } }).step, 'done', 'a skipped setup opens the workspace straight away');
    }
  }
});

test('every permutation: the agent step only passes when an agent connected or the person skipped it', () => {
  for (const { reached } of ALL) {
    for (const { state, path } of reached.filter((r) => r.state.step === 'agent')) {
      if (!state.connected) assert.equal(reduce(state, { type: 'next' }).step, 'agent', `next without a connection holds: ${path.join('>')}`);
      assert.equal(reduce(state, { type: 'skip' }).step, 'done');
      assert.equal(reduce(reduce(state, { type: 'connected', at: 't' }), { type: 'next' }).step, 'done');
    }
  }
});

test('every permutation: an error always names a step the person can act on, and dismiss clears it', () => {
  for (const { who, q, reached } of ALL) {
    for (const { state, path } of reached.filter((r) => r.state.error)) {
      assert.ok(['account', 'workspace', 'work', 'agent', 'list', 'closed', 'done'].includes(state.step), `${who} ${JSON.stringify(q)} ${path.join('>')}: error parked on ${state.step}`);
      assert.equal(reduce(state, { type: 'dismiss' }).error, null);
    }
  }
});

test('build failures go back to the step that can fix them', () => {
  const at = (s) => reduce(reduce(reduce(begin(PEOPLE.newcomer), { type: 'next', name: 'Harbor', slug: 'harbor' }), { type: 'next', template: 'crm' }), s);
  assert.deepEqual([at({ type: 'fail', code: 'slug_taken' }).step, at({ type: 'fail', code: 'slug_taken' }).error.code], ['workspace', 'slug_taken']);
  assert.deepEqual([at({ type: 'fail', code: 'network' }).step, at({ type: 'fail', code: 'network' }).data.template], ['work', 'crm'], 'the choice survives a retry');
  const partial = at({ type: 'built', made: { name: 'harbor', templateError: 'boom' } });
  assert.deepEqual([partial.step, partial.error.code, partial.error.template], ['agent', 'template_failed', 'crm'], 'a failed template still opens an empty workspace');
  const skipLost = reduce(reduce(begin(PEOPLE.newcomer), { type: 'skip' }), { type: 'fail', code: 'slug_taken' });
  assert.deepEqual([skipLost.step, skipLost.skipped], ['workspace', false], 'a quick setup that loses its name asks for one');
});

test('back never re-runs a build and never leaves a signed-in person on the account step', () => {
  for (const { reached } of ALL) {
    for (const { state } of reached) {
      const b = reduce(state, { type: 'back' });
      if (state.step !== 'build') assert.notEqual(b.step, 'build');
      if (state.me.signedIn) assert.notEqual(b.step, 'account');
      if (['agent', 'done', 'build'].includes(state.step)) assert.ok(['agent', 'done', 'build'].includes(b.step), 'no way back past the build');
    }
  }
});

test('rail: four labels, done before the current one', () => {
  const s = reduce(reduce(begin(PEOPLE.newcomer), { type: 'next', name: 'H', slug: 'h' }), { type: 'next' });
  assert.deepEqual(railState(s).map((r) => [r.label, r.state]), [['Account', 'done'], ['Workspace', 'done'], ['Template', 'on'], ['Agent', 'todo']]);
  assert.deepEqual(railState({ step: 'done' }).map((r) => r.state), ['done', 'done', 'done', 'done']);
});
