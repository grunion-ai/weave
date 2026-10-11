import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'weave-sec-export-'));
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave, fileHeaders } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const NAME = 'Quarterly plan: “Q4” résumé.pdf"; x=y';

async function stand() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const db = w.createTable({ space: 'S', name: 'Item' });
  const e = w.createEntity(db, { name: NAME, doc: 'Body text.' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, e, stop: () => server.close() };
}

test('the document and entity PDF exports carry the headers the file route gives a PDF (Issue #544)', async () => {
  const { base, e, stop } = await stand();
  try {
    for (const [tail, fallback] of [['doc.pdf', 'document'], ['entity.pdf', 'entity']]) {
      const res = await fetch(`${base}/e/${e.id}/${tail}`);
      assert.equal(res.status, 200, tail);
      const want = fileHeaders({ name: `${NAME}.pdf`, mime: 'application/pdf' }, Buffer.alloc(0));
      assert.equal(res.headers.get('content-type'), 'application/pdf', tail);
      assert.equal(res.headers.get('content-disposition'), want['Content-Disposition'], tail);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', tail);
      assert.equal(res.headers.get('content-security-policy'), want['Content-Security-Policy'], tail);
      const cd = res.headers.get('content-disposition');
      assert.match(cd, /^inline; filename="[\w.-]+\.pdf"; filename\*=UTF-8''/, `${tail}: an ASCII fallback and an RFC 6266 encoded name`);
      assert.ok(cd.includes("filename*=UTF-8''Quarterly%20plan%3A%20%E2%80%9CQ4%E2%80%9D%20r%C3%A9sum%C3%A9.pdf%22%3B%20x%3Dy.pdf"), `${tail}: the real name survives the encoding`);
      assert.ok(!cd.includes(fallback), `${tail}: the fallback name is not used while the row has a name`);
    }
  } finally { stop(); }
});

test('a nameless row exports as document.pdf and entity.pdf (Issue #544)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const db = w.createTable({ space: 'S', name: 'Item' });
  const e = w.createEntity(db, { name: '', doc: 'Body.' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [tail, fallback] of [['doc.pdf', 'document'], ['entity.pdf', 'entity']]) {
      const res = await fetch(`${base}/e/${e.id}/${tail}`);
      assert.equal(res.status, 200, tail);
      assert.equal(res.headers.get('content-disposition'), `inline; filename="${fallback}.pdf"; filename*=UTF-8''${fallback}.pdf`, tail);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', tail);
    }
  } finally { server.close(); }
});
