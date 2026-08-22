import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #16 — the attachments field type. Entity-level files have existed
   since v0.1; this puts a named SUBSET of them in a column: the value is an
   array of file ids, `attachToField` is the one verb that uploads and files
   in one motion, and deleting a file plucks it from every attachments value
   so a column can never point at a ghost. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Contract' });
  w.addField('Contract', { name: 'Signed PDFs', type: 'attachments' });
  return w;
}

test('attachToField uploads and files in one motion', () => {
  const w = fresh();
  const e = w.createEntity('Contract', { name: 'Acme' });
  const file = w.attachToField(e.id, 'Signed PDFs', { name: 'msa.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-fake') });
  const f = Object.values(w.getTable('Contract').fields).find((x) => x.name === 'Signed PDFs');
  assert.deepEqual(w.getEntity(e.id).values[f.id], [file.id]);
  assert.ok(w.getEntity(e.id).files.some((x) => x.id === file.id), 'the blob rides the entity file store');
  assert.match(String(w.readEntity(e.id).fields['Signed PDFs']), /msa\.pdf/, 'the cell names its files');
});

test('deleting a file plucks it from the column', () => {
  const w = fresh();
  const e = w.createEntity('Contract', { name: 'Acme' });
  const a = w.attachToField(e.id, 'Signed PDFs', { name: 'a.pdf', bytes: Buffer.from('a') });
  const b = w.attachToField(e.id, 'Signed PDFs', { name: 'b.pdf', bytes: Buffer.from('b') });
  w.deleteFile(e.id, a.id);
  const f = Object.values(w.getTable('Contract').fields).find((x) => x.name === 'Signed PDFs');
  assert.deepEqual(w.getEntity(e.id).values[f.id], [b.id], 'no ghost ids');
});

test('the value only accepts the entity\'s own files', () => {
  const w = fresh();
  const e1 = w.createEntity('Contract', { name: 'A' });
  const e2 = w.createEntity('Contract', { name: 'B' });
  const foreign = w.attachFile(e2.id, { name: 'other.pdf', bytes: Buffer.from('x') });
  assert.throws(() => w.updateEntity(e1.id, { 'Signed PDFs': [foreign.id] }), /file/i);
});

test('attachments is definable and registry-visible', () => {
  const w = fresh();
  const row = w.listEntities(w.getTable('Fields').id).find((e) => w.entityName(e) === 'Signed PDFs');
  assert.ok(row, 'the column is in the Fields registry');
});

test('the REST field-upload route attaches into the column', async () => {
  const w = fresh();
  const e = w.createEntity('Contract', { name: 'Acme' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/entities/${e.id}/fields/Signed%20PDFs/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nda.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-x').toString('base64') }),
    });
    assert.equal(res.status, 201);
    const read = await (await fetch(`${base}/api/entities/${e.id}`)).json();
    assert.match(String(read.fields['Signed PDFs']), /nda\.pdf/);
  } finally {
    server.close();
  }
});
