import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/doc-draft-core.js');
const { keyOf, keep, drop, read, offer } = globalThis.WeaveDocDraft;

function shelf(seed = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
  };
}

test('one key per entity and field', () => {
  assert.equal(keyOf('e1', 'Description'), 'wv-doc-draft:e1::Description');
  assert.notEqual(keyOf('e1', 'Notes'), keyOf('e1', 'Description'));
  assert.notEqual(keyOf('e2', 'Notes'), keyOf('e1', 'Notes'));
});

test('a kept draft reads back with the time it was written', () => {
  const store = shelf();
  assert.equal(keep(store, 'e1', 'Description', 'half a sentence', '2026-11-12T18:00:00.000Z'), true);
  assert.deepEqual(read(store, 'e1', 'Description'), { value: 'half a sentence', at: '2026-11-12T18:00:00.000Z' });
  assert.equal(read(store, 'e1', 'Notes'), null);
});

test('a dropped draft is gone', () => {
  const store = shelf();
  keep(store, 'e1', 'Description', 'half a sentence', '2026-11-12T18:00:00.000Z');
  drop(store, 'e1', 'Description');
  assert.equal(read(store, 'e1', 'Description'), null);
  assert.equal(store.items.size, 0);
});

test('a malformed entry reads as no draft and clears itself', () => {
  const store = shelf({ 'wv-doc-draft:e1::Description': '{ not json' });
  assert.equal(read(store, 'e1', 'Description'), null);
  assert.equal(store.items.size, 0);
  const typed = shelf({ 'wv-doc-draft:e1::Description': JSON.stringify({ value: 7 }) });
  assert.equal(read(typed, 'e1', 'Description'), null);
  assert.equal(typed.items.size, 0);
});

test('a store that refuses the write never throws at the typist', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  assert.equal(keep(full, 'e1', 'Description', 'half a sentence', '2026-11-12T18:00:00.000Z'), false);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(read(blocked, 'e1', 'Description'), null);
  assert.doesNotThrow(() => drop(blocked, 'e1', 'Description'));
  assert.equal(keep(null, 'e1', 'Description', 'x', 'now'), false);
  assert.equal(read(null, 'e1', 'Description'), null);
});

test('a draft is offered only when it differs from the served text', () => {
  const held = { value: 'half a sentence', at: '2026-11-12T18:00:00.000Z' };
  assert.equal(offer(held, ''), true);
  assert.equal(offer(held, 'the whole sentence'), true);
  assert.equal(offer(held, 'half a sentence'), false);
  assert.equal(offer({ value: '', at: 'now' }, ''), false);
  assert.equal(offer(null, ''), false);
});

test('settle offers the draft the server never took', () => {
  const store = shelf();
  keep(store, 'e1', 'Description', 'half a sentence', '2026-11-12T18:00:00.000Z');
  assert.deepEqual(globalThis.WeaveDocDraft.settle(store, 'e1', 'Description', ''), { value: 'half a sentence', at: '2026-11-12T18:00:00.000Z' });
  assert.equal(store.items.size, 1, 'and leaves it in place until the typist answers');
});

test('settle clears a draft the served text already carries', () => {
  const store = shelf();
  keep(store, 'e1', 'Description', 'half a sentence', '2026-11-12T18:00:00.000Z');
  assert.equal(globalThis.WeaveDocDraft.settle(store, 'e1', 'Description', 'half a sentence'), null);
  assert.equal(store.items.size, 0, 'a draft that landed on the way out is not offered twice');
  assert.equal(globalThis.WeaveDocDraft.settle(shelf(), 'e1', 'Description', ''), null);
});
