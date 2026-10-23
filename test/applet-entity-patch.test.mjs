import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const PASSCODE = '20261080';

async function stand() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  w.addField('Product/Task', { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
  w.createSpace({ name: 'Other' });
  w.createTable({ space: 'Other', name: 'Note' });
  const task = w.createEntity('Product/Task', { Name: 'Ship the census', Priority: 'P1' });
  const note = w.createEntity('Other/Note', { Name: 'Not a task' });
  const prior = { passcode: process.env.WEAVE_APPLET_PASSCODE, table: process.env.WEAVE_APPLET_TABLE };
  process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
  delete process.env.WEAVE_APPLET_TABLE;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const unlocked = await fetch(`${base}/t/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  assert.equal(unlocked.status, 200);
  const cookie = (unlocked.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (method, path, body, { session = true } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const stop = () => {
    server.close();
    for (const [k, v] of [['WEAVE_APPLET_PASSCODE', prior.passcode], ['WEAVE_APPLET_TABLE', prior.table]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { w, task, note, call, stop };
}

test('PATCH /t/entity/:id writes through the passcode session and answers the applet row', async () => {
  const { w, task, call, stop } = await stand();
  try {
    const ok = await call('PATCH', `/t/entity/${task.id}`, { values: { Priority: 'P0', Name: 'Ship the census now' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.id, task.id);
    assert.equal(ok.json.name, 'Ship the census now');
    assert.equal(ok.json.fields.Priority, 'P0', 'the applet row flattens the select to its name');
    assert.equal(w.readEntity(task.id).fields.Priority, 'P0', 'the write is stored');
  } finally {
    stop();
  }
});

test('PATCH /t/entity/:id is refused without the session and for a row outside the applet table', async () => {
  const { w, task, note, call, stop } = await stand();
  try {
    const locked = await call('PATCH', `/t/entity/${task.id}`, { values: { Priority: 'P2' } }, { session: false });
    assert.equal(locked.status, 401);
    assert.equal(locked.json.code, 'unauthorized');
    const outside = await call('PATCH', `/t/entity/${note.id}`, { values: { Name: 'Hijacked' } });
    assert.equal(outside.status, 404, 'the applet writes only rows of its own table');
    assert.equal(w.readEntity(task.id).fields.Priority, 'P1');
    assert.equal(w.readEntity(note.id).name, 'Not a task');
  } finally {
    stop();
  }
});

test('POST /t/entity/:id/doc replaces the document like PUT, and a body without text is refused', async () => {
  const { w, task, call, stop } = await stand();
  try {
    const ok = await call('POST', `/t/entity/${task.id}/doc`, { doc: '# Plan\n\nCount every route.' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.match(ok.json.docHtml, /<h1[^>]*>Plan<\/h1>/);
    assert.equal(w.readEntity(task.id).doc, '# Plan\n\nCount every route.');
    const empty = await call('POST', `/t/entity/${task.id}/doc`, { text: 'wrong key' });
    assert.equal(empty.status, 400);
    assert.equal(w.readEntity(task.id).doc, '# Plan\n\nCount every route.', 'a refused write keeps the document');
  } finally {
    stop();
  }
});
