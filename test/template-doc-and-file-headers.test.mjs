import test from 'node:test';
import assert from 'node:assert/strict';
import { templateDoc, fileHeaders } from '../src/engine.js';

test('a template table with no fields array comes out with an empty field list', () => {
  const { doc } = templateDoc({ space: 'Ops', tables: [{ name: 'Ticket' }] }, { name: 'Support' });
  assert.equal(doc.space, 'Support');
  assert.deepEqual(doc.tables.map((t) => t.name), ['Ticket']);
  assert.deepEqual(doc.tables[0].fields, []);
});

test('a download name with quotes and brackets is percent-encoded in the extended filename', () => {
  const headers = fileHeaders({ name: "it's (final)*!.txt", mime: 'text/plain' }, Buffer.from('x'));
  const disposition = headers['Content-Disposition'];
  assert.match(disposition, /filename\*=UTF-8''it%27s%20%28final%29%2A%21\.txt$/);
  assert.match(disposition, /filename="it_s_final_\.txt"/);
});

test('a plain download name is left unencoded beyond the URL rules', () => {
  const headers = fileHeaders({ name: 'report.pdf', mime: 'application/pdf' }, Buffer.from('x'));
  assert.match(headers['Content-Disposition'], /filename\*=UTF-8''report\.pdf$/);
});
