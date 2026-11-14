import test from 'node:test';
import assert from 'node:assert/strict';
import { fnBody, liftFunction } from './lib/source.mjs';

const liftAsync = (name, deps) => new Function(...Object.keys(deps), `return async ${fnBody(name)}`)(...Object.values(deps));
const undoKey = (u) => `${u.kind}|${u.entityId}|${u.ts}`;
const at = (s) => `2026-11-10T12:00:${s}Z`;
const ms = (s) => Date.parse(at(s));
const entry = (kind, entityId, ts) => ({ kind, entityId, ts: at(ts) });

function tab(top = [], { between = null, afterRefusal = null } = {}) {
  const gestures = [];
  const pendingClaims = [];
  const asked = [];
  const looseIds = new Set();
  let land = between;
  const claimOwn = liftFunction('claimOwn', { pendingClaims, gestures, undoKey, looseIds });
  const pinClaims = liftFunction('pinClaims', { pendingClaims, looseIds });
  const api = async (method, path, body) => {
    asked.push(body ? `${method} ${path} ${JSON.stringify(body)}` : `${method} ${path}`);
    if (method === 'GET') {
      const seen = top.slice();
      if (land) { land(); land = null; }
      return seen;
    }
    if (body.expect && body.expect.join() !== top.slice(0, body.steps).map(undoKey).join()) {
      afterRefusal?.();
      throw Object.assign(new Error('Changed since, so nothing was undone'), { status: 409, code: 'conflict' });
    }
    return { undone: top.slice(0, body.steps).map((u) => ({ kind: u.kind, name: u.entityId })) };
  };
  const stepBackOwn = liftAsync('stepBackOwn', { gestures, pendingClaims, api, claimOwn, undoKey, UNDO_WINDOW: 200 });
  const gesture = () => {
    const g = { ids: [], keys: new Set() };
    gestures.push(g);
    return g;
  };
  const wrote = (g, kind, id, [lo, hi] = [], { oldest = false, took = 40 } = {}) => {
    g.ids.push(id);
    pendingClaims.push({ g, kind, id, lo: lo ? ms(lo) : -Infinity, hi: hi ? ms(hi) : Infinity, oldest, took });
    if (oldest) looseIds.add(id);
  };
  return { claimOwn: () => claimOwn(top), pinClaims, stepBackOwn, gesture, wrote, asked, pendingClaims };
}

test('a claim takes the entry this tab wrote, not a later edit of the same row from another tab (Issue #1692)', () => {
  const mine = entry('update', 'r1', '01.000');
  const t = tab([entry('update', 'r1', '03.000'), mine, entry('update', 'r1', '00.500')]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['00.999', '01.100']);
  t.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(mine)], 'the entry stamped while this write was in flight is the one it made');
  assert.equal(t.pendingClaims.length, 0, 'and the queue is drained');
});

test('an automation that writes the same row inside the request never stands in for the write that set it off (Issue #1692)', () => {
  const mine = entry('update', 'r1', '01.050');
  const t = tab([mine, entry('update', 'r1', '01.020'), entry('update', 'r1', '00.500')]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['01.010', '01.200']);
  t.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(mine)], 'the newest entry of the request is the write; the automation\'s sits under it');
});

test('a write the server recorded nothing for claims nothing, even with an older entry on its row on top (Issue #1692)', () => {
  const t = tab([entry('update', 'r1', '01.000')]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['02.000', '02.100']);
  t.claimOwn();
  assert.equal(g.keys.size, 0);
});

test('two quick writes of this tab to one row keep their own entries (Issue #1692)', () => {
  const first = entry('update', 'r1', '01.010');
  const second = entry('update', 'r1', '01.260');
  const t = tab([second, first]);
  const g1 = t.gesture(), g2 = t.gesture();
  t.wrote(g1, 'update', 'r1', ['01.000', '01.300']);
  t.wrote(g2, 'update', 'r1', ['01.250', '01.500']);
  t.claimOwn();
  assert.deepEqual([...g2.keys], [undoKey(second)]);
  assert.deepEqual([...g1.keys], [undoKey(first)]);
});

test('a paste claimed at undo time takes the oldest entry in its seconds, so a later edit of its row from another tab is not its (Issue #1692)', () => {
  const pasted = entry('update', 'r1', '05.300');
  const t = tab([entry('update', 'r1', '20.000'), entry('update', 'r1', '06.000'), pasted]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['03.000', '08.000'], { oldest: true });
  t.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(pasted)], 'the edit a second later, inside the window, and the one far outside it are both left alone');
});

test('a cell edit claims before a paste over the same row, so each keeps its own entry (Issue #1692)', () => {
  const edit = entry('update', 'r1', '04.000');
  const pasted = entry('update', 'r1', '05.300');
  const t = tab([pasted, edit]);
  const paste = t.gesture(), cell = t.gesture();
  t.wrote(cell, 'update', 'r1', ['03.990', '04.100']);
  t.wrote(paste, 'update', 'r1', ['03.000', '08.000'], { oldest: true });
  t.claimOwn();
  assert.deepEqual([...cell.keys], [undoKey(edit)]);
  assert.deepEqual([...paste.keys], [undoKey(pasted)]);
});

test('claims with no window go newest first, so two writes to one row keep their order (Issue #1692)', () => {
  const first = entry('update', 'r1', '01.000');
  const second = entry('update', 'r1', '02.000');
  const t = tab([second, first]);
  const g1 = t.gesture(), g2 = t.gesture();
  t.wrote(g1, 'update', 'r1');
  t.wrote(g2, 'update', 'r1');
  t.claimOwn();
  assert.deepEqual([...g2.keys], [undoKey(second)]);
  assert.deepEqual([...g1.keys], [undoKey(first)]);
});

test('a claim matches the kind too: an automation\'s update of a new row never stands in for its create (Issue #1692)', () => {
  const created = entry('create', 'n1', '01.000');
  const t = tab([entry('update', 'n1', '02.000'), created]);
  const g = t.gesture();
  t.wrote(g, 'create', 'n1');
  t.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(created)]);
});

test('an entry one gesture holds is never claimed again by another (Issue #1692)', () => {
  const held = entry('update', 'r1', '01.000');
  const t = tab([held]);
  const g1 = t.gesture();
  g1.keys.add(undoKey(held));
  const g2 = t.gesture();
  t.wrote(g2, 'update', 'r1');
  t.claimOwn();
  assert.equal(g2.keys.size, 0);
  assert.deepEqual([...g1.keys], [undoKey(held)]);
});

test('a tab with no writes of its own sends no request at all (Issue #1692)', async () => {
  const t = tab([entry('update', 'r1', '01.000')]);
  assert.equal(await t.stepBackOwn(null), null);
  assert.deepEqual(t.asked, []);
});

test('a tab whose writes sit under someone else\'s refuses and sends no POST (Issue #1692)', async () => {
  const mine = entry('update', 'r1', '01.000');
  const t = tab([entry('update', 'r2', '02.000'), mine]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['00.999', '01.100']);
  assert.deepEqual(await t.stepBackOwn(null), { blocked: true });
  assert.deepEqual(t.asked, ['GET /undo?limit=200'], 'one read of the stack, no undo');
  assert.deepEqual([...g.keys], [undoKey(mine)], 'and the write stays this tab\'s for later');
});

test('a gesture on top steps back exactly its own entries (Issue #1692)', async () => {
  const a = entry('update', 'r1', '01.000'), b = entry('update', 'r2', '01.000'), older = entry('update', 'r3', '00.000');
  const t = tab([b, a, older]);
  const paste = t.gesture();
  t.wrote(paste, 'update', 'r1');
  t.wrote(paste, 'update', 'r2');
  const r = await t.stepBackOwn(null);
  assert.deepEqual(t.asked, ['GET /undo?limit=200', `POST /undo {"steps":2,"expect":["${undoKey(b)}","${undoKey(a)}"]}`], 'two steps, not one and not the older third, named by key');
  assert.deepEqual(r.popped, [b, a]);
  assert.equal(paste.keys.size, 0, 'the gesture is spent');
});

test('the first read of a pasted row pins its loose claim to the row\'s own write time (Issue #1692)', () => {
  const reset = entry('update', 'r1', '04.500');
  const pasted = entry('update', 'r1', '05.310');
  const t = tab([pasted, reset]);
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['03.000', '08.000'], { oldest: true });
  t.pinClaims({ id: 'r1', updatedAt: at('05.300') });
  t.pinClaims({ id: 'r1', updatedAt: at('09.000') });
  t.claimOwn();
  assert.deepEqual([...g.keys], [undoKey(pasted)], 'a write half a second before the paste, inside the coarse window, stays out');
});

test("a write of the same actor that lands between this tab's read and its POST is not undone in its place (Issue #1727)", async () => {
  const mine = entry('update', 'r1', '01.000');
  const stack = [mine];
  const t = tab(stack, { between: () => stack.unshift(entry('update', 'r2', '02.000')) });
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['00.999', '01.100']);
  assert.deepEqual(await t.stepBackOwn(null), { blocked: true }, 'the tab refuses rather than undo the other write');
  assert.deepEqual(t.asked, [
    'GET /undo?limit=200',
    `POST /undo {"steps":1,"expect":["${undoKey(mine)}"]}`,
    'GET /undo?limit=200',
  ], 'the POST named the entry it read, and the refusal sent it back to the stack once');
  assert.deepEqual([...g.keys], [undoKey(mine)], "and the tab's own write stays its to undo");
});

test("a stack that settles while the refusal travels lets the recount step back the tab's own run (Issue #1727)", async () => {
  const mine = entry('update', 'r1', '01.000');
  const other = entry('update', 'r2', '02.000');
  const stack = [mine];
  const t = tab(stack, { between: () => stack.unshift(other), afterRefusal: () => stack.shift() });
  const g = t.gesture();
  t.wrote(g, 'update', 'r1', ['00.999', '01.100']);
  const r = await t.stepBackOwn(null);
  assert.deepEqual(r.popped, [mine], "the second read found the tab's own entry back on top");
  assert.deepEqual(t.asked, [
    'GET /undo?limit=200',
    `POST /undo {"steps":1,"expect":["${undoKey(mine)}"]}`,
    'GET /undo?limit=200',
    `POST /undo {"steps":1,"expect":["${undoKey(mine)}"]}`,
  ], 'one recount, no more');
  assert.equal(g.keys.size, 0, 'the gesture is spent');
});
