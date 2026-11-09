import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const w = new Weave();
  w.createSpace({ name: 'Work' });
  const table = w.createTable({ space: 'Work', name: 'Task' });
  const row = w.createEntity(table.id, { name: 'Row' });
  w.setDoc(row.id, 'FIRST_TEXT');
  return { w, row };
}

const put = (fetch, id, body) => fetch(`/api/entities/${id}/doc`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('a document write with the base it started from lands and answers the base of the stored text (Issue #1443)', async () => {
  const { w, row } = fixture();
  await withServer(w, async ({ fetch }) => {
    const res = await put(fetch, row.id, { field: 'Description', doc: 'SECOND_TEXT', base: hash('FIRST_TEXT') });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.base, hash('SECOND_TEXT'), 'the answer names the base the next write starts from');
    assert.equal(w.getDoc(row.id), 'SECOND_TEXT');
  });
});

test('a document write from a stale base is refused with 412 and the stored text, and writes nothing (Issue #1443)', async () => {
  const { w, row } = fixture();
  await withServer(w, async ({ fetch }) => {
    assert.equal((await put(fetch, row.id, { field: 'Description', doc: 'NEWER_TEXT', base: hash('FIRST_TEXT') })).status, 200);
    const res = await put(fetch, row.id, { field: 'Description', doc: 'OLDER_TEXT', base: hash('FIRST_TEXT') });
    assert.equal(res.status, 412, 'a write from the first text after another landed is refused');
    const body = await res.json();
    assert.equal(body.code, 'stale');
    assert.equal(body.entity?.docs?.Description, 'NEWER_TEXT', 'the refusal carries the stored text so the client can show both');
    assert.equal(w.getDoc(row.id), 'NEWER_TEXT', 'the stale write changed nothing');
  });
});

test('a document base guards only its own field, and a write with no base still lands (Issue #1443)', async () => {
  const { w, row } = fixture();
  w.addField(w.getEntity(row.id).dbId, { name: 'Notes', type: 'document' });
  await withServer(w, async ({ fetch }) => {
    assert.equal((await put(fetch, row.id, { field: 'Notes', doc: 'NOTES_TEXT', base: hash('') })).status, 200, 'an empty document has the base of empty text');
    assert.equal((await put(fetch, row.id, { field: 'Description', doc: 'AFTER_NOTES', base: hash('FIRST_TEXT') })).status, 200, 'a change to another document is no conflict');
    assert.equal((await put(fetch, row.id, { field: 'Description', doc: 'NO_BASE' })).status, 200);
    assert.equal(w.getDoc(row.id), 'NO_BASE');
  });
});
