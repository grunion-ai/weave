import test from 'node:test';
import assert from 'node:assert/strict';
import { fnBody } from './lib/source.mjs';

const liftAsync = (name, deps) => new Function(...Object.keys(deps), `return async ${fnBody(name)}`)(...Object.values(deps));
const undoKey = (u) => `${u.kind}|${u.entityId}|${u.ts}`;
const at = (s) => `2026-11-10T12:00:${s}Z`;
const entry = (kind, entityId, ts) => ({ kind, entityId, ts: at(ts) });

function claimer(top) {
  const gestures = [];
  const pendingClaims = [];
  const asked = [];
  const api = async (method, path) => { asked.push(`${method} ${path}`); return top; };
  const claimOwn = liftAsync('claimOwn', { pendingClaims, gestures, undoKey, UNDO_WINDOW: 200, claimTimer: null, api });
  const gesture = () => {
    const g = { ids: [], keys: new Set() };
    gestures.push(g);
    return g;
  };
  const wrote = (g, kind, id, [since, upto] = []) => {
    g.ids.push(id);
    pendingClaims.push({ g, kind, id, since: since ? at(since) : null, upto: upto ? at(upto) : null });
  };
  return { claimOwn, gesture, wrote, asked, pendingClaims };
}

test('a claim takes the entry this tab wrote, not a later edit of the same row from another tab (Issue #1692)', async () => {
  const mine = entry('update', 'r1', '01.000');
  const c = claimer([entry('update', 'r1', '03.000'), mine, entry('update', 'r1', '00.500')]);
  const g = c.gesture();
  c.wrote(g, 'update', 'r1', ['00.999', '01.100']);
  await c.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(mine)], 'the entry stamped while this write was in flight is the one it made');
  assert.deepEqual(c.asked, ['GET /undo?limit=9'], 'one read of the top of the stack, sized to the claims');
  assert.equal(c.pendingClaims.length, 0, 'and the queue is drained');
});

test('an automation that writes the same row inside the request never stands in for the write that set it off (Issue #1692)', async () => {
  const mine = entry('update', 'r1', '01.050');
  const c = claimer([mine, entry('update', 'r1', '01.020'), entry('update', 'r1', '00.500')]);
  const g = c.gesture();
  c.wrote(g, 'update', 'r1', ['01.010', '01.200']);
  await c.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(mine)], 'the newest entry of the request is the write; the automation\'s sits under it');
});

test('a write the server recorded nothing for claims nothing, even with an older entry on its row on top (Issue #1692)', async () => {
  const c = claimer([entry('update', 'r1', '01.000')]);
  const g = c.gesture();
  c.wrote(g, 'update', 'r1', ['02.000', '02.100']);
  await c.claimOwn();
  assert.equal(g.keys.size, 0);
});

test('two quick writes of this tab to one row keep their own entries (Issue #1692)', async () => {
  const first = entry('update', 'r1', '01.010');
  const second = entry('update', 'r1', '01.260');
  const c = claimer([second, first]);
  const g1 = c.gesture(), g2 = c.gesture();
  c.wrote(g1, 'update', 'r1', ['01.000', '01.300']);
  c.wrote(g2, 'update', 'r1', ['01.250', '01.500']);
  await c.claimOwn();
  assert.deepEqual([...g2.keys], [undoKey(second)]);
  assert.deepEqual([...g1.keys], [undoKey(first)]);
});

test('claims without a timestamp go newest first, so two pastes over one row keep their own entries (Issue #1692)', async () => {
  const first = entry('update', 'r1', '01.000');
  const second = entry('update', 'r1', '02.000');
  const c = claimer([second, first]);
  const g1 = c.gesture(), g2 = c.gesture();
  c.wrote(g1, 'update', 'r1');
  c.wrote(g2, 'update', 'r1');
  await c.claimOwn();
  assert.deepEqual([...g2.keys], [undoKey(second)]);
  assert.deepEqual([...g1.keys], [undoKey(first)]);
});

test('a claim matches the kind too: an automation\'s update of a new row never stands in for its create (Issue #1692)', async () => {
  const created = entry('create', 'n1', '01.000');
  const c = claimer([entry('update', 'n1', '02.000'), created]);
  const g = c.gesture();
  c.wrote(g, 'create', 'n1');
  await c.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(created)]);
});

test('an entry one gesture holds is never claimed again by another (Issue #1692)', async () => {
  const held = entry('update', 'r1', '01.000');
  const c = claimer([held]);
  const g1 = c.gesture();
  g1.keys.add(undoKey(held));
  const g2 = c.gesture();
  c.wrote(g2, 'update', 'r1');
  await c.claimOwn();
  assert.equal(g2.keys.size, 0);
  assert.deepEqual([...g1.keys], [undoKey(held)]);
});

test('with nothing pending a claim reads nothing (Issue #1692)', async () => {
  const c = claimer([]);
  await c.claimOwn();
  assert.deepEqual(c.asked, []);
});
