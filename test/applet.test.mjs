/* The task applet (Feature: uno task applet).

   A passcode-gated single page over one table, built for mobile Safari.
   The gate is the point of these tests: the page, and every byte of task
   data behind it, must be unreachable without the cookie — and the cookie
   must be unforgeable from the outside. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const PASSCODE = '11243947';

/* A workspace shaped like uno's Product/Task, and a server with the applet
   passcode set. Returns { base, stop, weave, tasks }. */
async function stand(passcode = PASSCODE) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-applet-'));
  const w = new Weave({ path: join(dir, 'uno.json') });
  w.state.meta.name = 'uno';
  const space = w.createSpace({ name: 'Product' });
  const db = w.createTable({ space: space.id, name: 'Task' });
  w.addField(db.id, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2', 'P3'] } });
  w.addField(db.id, { name: 'Due', type: 'date' });
  w.addField(db.id, {
    name: 'State',
    type: 'workflow',
    config: {
      states: [
        { id: 'open', name: 'Open', category: 'not-started', default: true },
        { id: 'in-progress', name: 'In Progress', category: 'in-progress' },
        { id: 'review', name: 'Review', category: 'in-progress' },
        { id: 'done', name: 'Done', category: 'done' },
        { id: 'canceled', name: 'Canceled', category: 'canceled' },
      ],
    },
  });
  const seeded = [
    w.createEntity(db.id, { Name: 'Design onboarding wizard', State: 'In Progress', Priority: 'P0' }),
    w.createEntity(db.id, { Name: 'Billing API migration', State: 'Open', Priority: 'P1' }),
    w.createEntity(db.id, { Name: 'Fix signup race condition', State: 'Done', Priority: 'P0' }),
  ];

  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = passcode;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, weave: w, db, tasks: seeded,
    stop() {
      server.close();
      if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
      else process.env.WEAVE_APPLET_PASSCODE = prior;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const unlock = async (base, code = PASSCODE) => fetch(`${base}/t/unlock`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passcode: code }),
});

const cookieFrom = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

test('applet: the page is the keypad until the passcode is entered', async () => {
  const s = await stand();
  try {
    const res = await fetch(`${s.base}/t`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /wv-pad/, 'the locked page is the keypad');
    assert.doesNotMatch(html, /Design onboarding wizard/, 'no task may leak into the locked page');
    assert.doesNotMatch(html, new RegExp(PASSCODE), 'the passcode must never be served to the client');
  } finally { s.stop(); }
});

test('applet: a wrong passcode is refused and sets no cookie', async () => {
  const s = await stand();
  try {
    const res = await unlock(s.base, '00000000');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
  } finally { s.stop(); }
});

test('applet: repeated wrong passcodes are rate-limited', async () => {
  const s = await stand();
  try {
    let last = null;
    for (let i = 0; i < 12; i++) last = await unlock(s.base, '00000000');
    assert.equal(last.status, 429, 'guessing must stop being cheap');
    // The limiter must not lock out the real passcode forever, but it must
    // still refuse while the window is open.
    assert.equal((await unlock(s.base)).status, 429);
  } finally { s.stop(); }
});

test('applet: the right passcode sets an HttpOnly, SameSite=Lax cookie', async () => {
  const s = await stand();
  try {
    const res = await unlock(s.base);
    assert.equal(res.status, 200);
    const raw = res.headers.get('set-cookie') ?? '';
    assert.match(raw, /^wv_applet=/);
    assert.match(raw, /HttpOnly/i, 'script-written cookies are capped at 7 days by WebKit');
    assert.match(raw, /SameSite=Lax/i, 'the unlock POST has no CSRF token; SameSite is the defence');
    assert.match(raw, /Max-Age=\d{6,}/, 'the phone should stay unlocked');
    assert.doesNotMatch(raw, new RegExp(PASSCODE), 'the cookie must not carry the passcode');
  } finally { s.stop(); }
});

test('applet: the page renders the app once the cookie is present', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const html = await (await fetch(`${s.base}/t`, { headers: { cookie } })).text();
    assert.match(html, /wv-compose/, 'the unlocked page is the task list');
    assert.doesNotMatch(html, /wv-pad/, 'the keypad is gone once unlocked');
  } finally { s.stop(); }
});

test('applet: task data is refused without the cookie', async () => {
  const s = await stand();
  try {
    const res = await fetch(`${s.base}/t/data`);
    assert.equal(res.status, 401);
    const body = await res.text();
    assert.doesNotMatch(body, /Design onboarding wizard/);
  } finally { s.stop(); }
});

test('applet: a forged cookie is refused', async () => {
  const s = await stand();
  try {
    const res = await fetch(`${s.base}/t/data`, { headers: { cookie: 'wv_applet=' + 'a'.repeat(64) } });
    assert.equal(res.status, 401);
  } finally { s.stop(); }
});

test('applet: data opens on the active states, newest edit first', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const data = await (await fetch(`${s.base}/t/data`, { headers: { cookie } })).json();
    const names = data.items.map((i) => i.name);
    assert.ok(!names.includes('Fix signup race condition'), 'Done is not in the active view');
    assert.equal(names.length, 2);

    // Touch the older row; it must climb to the top.
    const older = data.items[data.items.length - 1];
    await fetch(`${s.base}/t/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: older.id, state: 'Review' }),
    });
    const after = await (await fetch(`${s.base}/t/data`, { headers: { cookie } })).json();
    assert.equal(after.items[0].id, older.id, 'the row you just touched sorts first');
  } finally { s.stop(); }
});

test('applet: ?scope=all includes the finished rows', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const data = await (await fetch(`${s.base}/t/data?scope=all`, { headers: { cookie } })).json();
    assert.equal(data.items.length, 3);
  } finally { s.stop(); }
});

test('applet: creating a task needs only a name and starts Open', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const res = await fetch(`${s.base}/t/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Call the roof adjuster' }),
    });
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.name, 'Call the roof adjuster');
    assert.equal(row.state, 'Open');
    const data = await (await fetch(`${s.base}/t/data`, { headers: { cookie } })).json();
    assert.equal(data.items[0].name, 'Call the roof adjuster', 'a new task is the newest edit');
  } finally { s.stop(); }
});

test('applet: creating a task is refused without the cookie', async () => {
  const s = await stand();
  try {
    const res = await fetch(`${s.base}/t/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'should not exist' }),
    });
    assert.equal(res.status, 401);
    assert.equal(s.weave.query('Product/Task').items.filter((i) => i.name === 'should not exist').length, 0);
  } finally { s.stop(); }
});

test('applet: a state change is refused unless the state is one the table knows', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const id = s.tasks[0].id;
    const bad = await fetch(`${s.base}/t/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id, state: 'Shipped' }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${s.base}/t/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id, state: 'Done' }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).state, 'Done');
  } finally { s.stop(); }
});

test('applet: the applet only ever reaches its own table', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    // A row from another table must not be addressable through the applet.
    const other = s.weave.createTable({ space: s.weave.findSpace('Product').id, name: 'Secret' });
    const row = s.weave.createEntity(other.id, { Name: 'salaries' });
    const res = await fetch(`${s.base}/t/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: row.id, state: 'Done' }),
    });
    assert.equal(res.status, 404, 'the applet is scoped to Product/Task');
  } finally { s.stop(); }
});

test('applet: a file attaches to a task and comes back on it', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const id = s.tasks[0].id;
    const res = await fetch(`${s.base}/t/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id, name: 'estimate.pdf', mime: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 roof').toString('base64') }),
    });
    assert.equal(res.status, 201);
    const file = await res.json();
    assert.equal(file.name, 'estimate.pdf');

    const one = await (await fetch(`${s.base}/t/entity/${id}`, { headers: { cookie } })).json();
    assert.equal(one.files.length, 1);
    assert.equal(one.files[0].id, file.id);

    const blob = await fetch(`${s.base}/t/file/${file.id}`, { headers: { cookie } });
    assert.equal(blob.status, 200);
    assert.match(await blob.text(), /roof/);
    assert.equal((await fetch(`${s.base}/t/file/${file.id}`)).status, 401, 'blobs are gated too');
  } finally { s.stop(); }
});

test('applet: with no passcode configured there is no applet at all', async () => {
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  delete process.env.WEAVE_APPLET_PASSCODE;
  const dir = mkdtempSync(join(tmpdir(), 'weave-applet-off-'));
  const w = new Weave({ path: join(dir, 'uno.json') });
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/t`);
    assert.equal(res.status, 404, 'an unconfigured applet must not serve a gate to guess at');
  } finally {
    server.close();
    if (prior !== undefined) process.env.WEAVE_APPLET_PASSCODE = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applet: the passcode never reaches the workspace file or the export', async () => {
  const s = await stand();
  try {
    await unlock(s.base);
    const dump = JSON.stringify(s.weave.exportJSON());
    assert.doesNotMatch(dump, new RegExp(PASSCODE), 'the passcode lives in the environment, not in the data');
  } finally { s.stop(); }
});

test('serve: the host is a choice, and loopback is the default', async () => {
  const { readFileSync } = await import('node:fs');
  const bin = readFileSync(new URL('../bin/weave.js', import.meta.url), 'utf8');
  assert.match(bin, /flags\.host \?\? process\.env\.WEAVE_HOST \?\? '127\.0\.0\.1'/,
    'the phone needs --host to reach the applet, and nothing else may widen the bind');
  assert.match(bin, /startServer\(w, \{ port, host \}\)/);

  const dir = mkdtempSync(join(tmpdir(), 'weave-host-'));
  const w = new Weave({ path: join(dir, 'uno.json') });
  const { server } = await startServer(w, { port: 0, host: '0.0.0.0' });
  try {
    assert.equal(server.address().address, '0.0.0.0', 'startServer honours the host it is given');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
