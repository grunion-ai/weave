/* A document write carries its text or it is refused (Issue #572).

   The route read `body.doc ?? body.markdown ?? ''`, so a PUT whose text sat
   under any other key wrote the fallback: 200 {"ok": true} and an erased
   document. An empty string is still a legitimate write — clearing a document
   is something people do — so the refusal has to tell a missing key from an
   explicit empty value, on every surface that takes the verb. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const KEPT = 'alpha\n\nbeta';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Marketing' });
  const leads = w.createTable({ space: 'Marketing', name: 'Leads' });
  const e = w.createEntity(leads, { name: 'doc route probe', doc: KEPT });
  return { w, leads, e };
}

async function stand() {
  const { w, e } = build();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const doc = (method, body) => fetch(`${base}/api/entities/${e.id}/doc`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { w, e, doc, stop: () => server.close() };
}

test('REST: a doc write with no recognized key is refused and changes nothing', async () => {
  const { w, e, doc, stop } = await stand();
  try {
    for (const method of ['PUT', 'POST']) {
      const res = await doc(method, { content: 'alpha\n\nbeta', field: 'Description' });
      assert.equal(res.status, 400, `${method} with an unknown key must not answer 200`);
      const { error } = await res.json();
      assert.match(error, /\bdoc\b/, 'the refusal names the key the route takes');
      assert.match(error, /\bmarkdown\b/, 'and the other spelling it accepts');
      assert.equal(w.getDoc(e.id), KEPT, `${method} left the stored document untouched`);
    }
  } finally { stop(); }
});

test('REST: an explicit empty value still clears the document', async () => {
  const { w, e, doc, stop } = await stand();
  try {
    assert.equal((await doc('PUT', { doc: '' })).status, 200);
    assert.equal(w.getDoc(e.id), '', 'clearing is a legitimate write');

    w.setDoc(e.id, KEPT);
    assert.equal((await doc('PUT', { markdown: '' })).status, 200);
    assert.equal(w.getDoc(e.id), '', 'under either spelling');

    // And an explicit empty append is allowed: it adds nothing but the gap.
    w.setDoc(e.id, KEPT);
    assert.equal((await doc('POST', { doc: '' })).status, 200);
    assert.ok(w.getDoc(e.id).startsWith(KEPT), 'an empty append keeps what was there');
  } finally { stop(); }
});

test('REST: the refusal reaches a named field, not just the default', async () => {
  const { w, leads } = build();
  w.addField(leads, { name: 'Spec', type: 'document' });
  const e = w.createEntity(leads, { name: 'named field probe', docs: { Spec: KEPT } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/entities/${e.id}/doc`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'rewritten', field: 'Spec' }),
    });
    assert.equal(res.status, 400);
    assert.equal(w.getDoc(e.id, 'Spec'), KEPT);
  } finally { server.close(); }
});

test('the engine refuses a document write with no text at all', () => {
  const { w, e } = build();
  // A bad entity reference is still a bad entity reference, not a text error.
  assert.throws(() => w.setDoc('no-such-entity', undefined), (err) => err.code === 'not-found');
  assert.throws(() => w.setDoc(e.id, undefined), /needs its text/);
  assert.throws(() => w.setDoc(e.id, null), /needs its text/);
  assert.throws(() => w.appendDoc(e.id, undefined), /needs its text/);
  assert.equal(w.getDoc(e.id), KEPT, 'a refused write is not a write');

  // The error is an invalid-input error, which is what makes it a 400 over HTTP.
  assert.throws(() => w.setDoc(e.id, undefined), (err) => err.code === 'invalid');

  w.setDoc(e.id, '');
  assert.equal(w.getDoc(e.id), '', 'an explicit empty string still clears it');
});

test('MCP: weave_set_doc needs its markdown', () => {
  const { w, e } = build();
  assert.throws(() => dispatchTool(w, 'weave_set_doc', { entity: e.id }), /needs its text/);
  assert.throws(() => dispatchTool(w, 'weave_set_doc', { entity: e.id, mode: 'append' }), /needs its text/);
  assert.equal(w.getDoc(e.id), KEPT);
  assert.equal(dispatchTool(w, 'weave_set_doc', { entity: e.id, markdown: '' }).length, 0);
});

test('CLI: doc set with neither --content nor --file is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-doc-keys-'));
  const data = join(dir, 'ws.json');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
  try {
    cli('space', 'create', 'Marketing');
    cli('db', 'create', 'Marketing', 'Leads');
    cli('create', 'Leads', 'doc route probe');
    cli('doc', 'set', 'Leads#1', '--content', KEPT);
    assert.equal(cli('doc', 'get', 'Leads#1').trimEnd(), KEPT);

    for (const sub of ['set', 'append']) {
      for (const args of [[], ['--content']]) { // no flag at all, and a bare --content that parses as true
        assert.throws(() => cli('doc', sub, 'Leads#1', ...args), (err) => {
          assert.match(String(err.stderr), /--content|--file/, 'the refusal names the flags that carry the text');
          return true;
        });
        assert.equal(cli('doc', 'get', 'Leads#1').trimEnd(), KEPT, `doc ${sub} ${args.join(' ')} left it alone`);
      }
    }

    cli('doc', 'set', 'Leads#1', '--content', '');
    assert.equal(cli('doc', 'get', 'Leads#1').trimEnd(), '', '--content "" still clears it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
