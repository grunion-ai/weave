import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const PASSCODE = '20261682';
const hash = (text) => createHash('sha256').update(text).digest('hex');

async function stand() {
  const w = new Weave({ actor: 'web' });
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  const task = w.createEntity('Product/Task', { Name: 'Ship the census' });
  w.setDoc(task.id, 'FIRST_TEXT');
  const prior = { passcode: process.env.WEAVE_APPLET_PASSCODE, table: process.env.WEAVE_APPLET_TABLE };
  process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
  delete process.env.WEAVE_APPLET_TABLE;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const unlocked = await fetch(`${base}/t/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
  const cookie = (unlocked.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const page = async () => (await fetch(`${base}/t`, { headers: { Cookie: cookie } })).text();
  const stop = () => {
    server.close();
    for (const [k, v] of [['WEAVE_APPLET_PASSCODE', prior.passcode], ['WEAVE_APPLET_TABLE', prior.table]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { w, task, call, page, stop };
}

test('the applet reads a task with the base of its description, and a write from that base lands and answers the next one (Issue #1682)', async () => {
  const { w, task, call, stop } = await stand();
  try {
    const read = await call('GET', `/t/entity/${task.id}`);
    assert.equal(read.json.base, hash('FIRST_TEXT'));
    const wrote = await call('PUT', `/t/entity/${task.id}/doc`, { doc: 'PHONE_TEXT', base: read.json.base });
    assert.equal(wrote.status, 200);
    assert.equal(wrote.json.base, hash('PHONE_TEXT'));
    assert.equal(w.getDoc(task.id), 'PHONE_TEXT');
  } finally { stop(); }
});

test('an applet write from a stale base, or with none on a written document, is refused with the stored text and writes nothing (Issue #1682)', async () => {
  const { w, task, call, stop } = await stand();
  try {
    const opened = (await call('GET', `/t/entity/${task.id}`)).json.base;
    w.actor = 'mcp:agent';
    w.setDoc(task.id, 'AGENT_TEXT');
    const stale = await call('PUT', `/t/entity/${task.id}/doc`, { doc: 'PHONE_TEXT', base: opened });
    assert.equal(stale.status, 412);
    assert.equal(stale.json.code, 'stale');
    assert.equal(stale.json.doc, 'AGENT_TEXT', 'the refusal carries what the server holds');
    assert.equal(stale.json.base, hash('AGENT_TEXT'), 'and its base, for Use mine');
    const blind = await call('POST', `/t/entity/${task.id}/doc`, { doc: 'NO_BASE' });
    assert.equal(blind.status, 412, 'a write that names no base lands only on an empty document');
    assert.equal(w.getDoc(task.id), 'AGENT_TEXT');
    const mine = await call('PUT', `/t/entity/${task.id}/doc`, { doc: 'PHONE_TEXT', base: stale.json.base });
    assert.equal(mine.status, 200);
    assert.equal(w.getDoc(task.id), 'PHONE_TEXT');
  } finally { stop(); }
});

test('the applet page hashes text exactly as the server does, with no crypto.subtle (Issue #1682)', async () => {
  const { page, stop } = await stand();
  try {
    const src = await page();
    const fn = /const docBase = (\(text\) => \{[\s\S]*?\n {2}\});/.exec(src)?.[1];
    assert.ok(fn, 'the page carries its own SHA-256');
    assert.doesNotMatch(fn, /crypto/, 'a page served over plain http has no crypto.subtle to lean on');
    const docBase = new Function(`return ${fn}`)();
    const samples = ['', 'a', 'FIRST_TEXT', 'é à ü', '日本語のテキスト', '🧵 weave 🪡', '\n\n- [ ] task\n', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'ü'.repeat(60), 'line\n'.repeat(4000)];
    for (const text of samples) assert.equal(docBase(text), hash(text), `${JSON.stringify(text.slice(0, 20))} (${text.length} chars)`);
  } finally { stop(); }
});
