/* The task applet (Feature: uno task applet).

   A passcode-gated single page over one table, built for mobile Safari.
   The gate is the point of these tests: the page, and every byte of task
   data behind it, must be unreachable without the cookie — and the cookie
   must be unforgeable from the outside. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
    assert.match(html, /wv-pad/, 'the locked page shows the keypad');
    assert.doesNotMatch(html, /Design onboarding wizard/, 'no task may leak into the locked page');
    assert.doesNotMatch(html, /Priority|In Progress/, 'nor may the schema');
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
    assert.doesNotMatch(html, /id="gate"/, 'the keypad is gone once unlocked');
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
    assert.equal(row.fields.State, 'Open', 'the default state comes from the field, not from the applet');
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
    assert.equal((await ok.json()).fields.State, 'Done');
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

/* Kyle, 2026-08-28: "bug from the [applet] not captured". The applet was
   posting {title, description, symptoms, context} at an endpoint that speaks
   {categories, note, events, client} — every report 400ed, and the applet
   said "Reported" anyway because it never looked at the status. Both halves
   are pinned here. */
test('applet: the bug sheet speaks the shape /api/bug-report accepts', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  assert.match(src, /categories:/, 'the endpoint reads body.categories');
  assert.match(src, /\bnote[,:]/, 'the endpoint reads body.note');
  assert.doesNotMatch(src, /symptoms: \[\.\.\.picked\]/, 'symptoms/description was the shape that 400ed');
  // Never claim a report landed without looking.
  assert.match(src, /res\.ok/, 'the applet must check the response before saying it was reported');

  const { BUG_CATEGORIES } = await import('../src/bugreport.js');
  const ids = BUG_CATEGORIES.map((c) => c.id);
  for (const id of ids) {
    assert.ok(src.includes(`'${id}'`), `the sheet offers the real category '${id}'`);
  }
});

test('applet: a report filed the way the applet files it becomes an Issue', async () => {
  const { seedWeaver } = await import('../src/weaver-seed.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-bug-'));
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
  const w = new Weave({ path: join(dir, 'uno.json') });
  w.state.meta.name = 'uno';
  const docs = new Weave({ path: join(dir, 'weave.json') });
  seedWeaver(docs);
  const { server } = await startServer(w, { port: 0, workspaces: { weave: docs } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: ['broken-ui'],
        note: 'The chips wrap onto three lines on the phone',
        events: [],
        client: { surface: 'task applet', url: '/w/uno/t', ua: 'iPhone' },
      }),
    });
    const raw = await res.text();
    assert.equal(res.status, 201, raw);
    const filed = JSON.parse(raw);
    assert.ok(filed.publicId, 'a filed report comes back with the issue number to show the reporter');
    const issues = docs.query('Development/Issue');
    assert.ok(issues.items.some((i) => /chips wrap/.test(JSON.stringify(i))), 'the note reaches the Issue');
  } finally {
    server.close();
    if (prior === undefined) delete process.env.WEAVE_APPLET_PASSCODE;
    else process.env.WEAVE_APPLET_PASSCODE = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Kyle, 2026-08-28: "make sure this page is field driven". The applet must
   read the table it is pointed at, not a list of field names baked into it —
   a workflow called Stage, a select called Urgency, a field added tomorrow. */
async function standStage() {
  const dir = mkdtempSync(join(tmpdir(), 'weave-applet-stage-'));
  const w = new Weave({ path: join(dir, 'work.json') });
  w.state.meta.name = 'work';
  const space = w.createSpace({ name: 'Ops' });
  const db = w.createTable({ space: space.id, name: 'Job' });
  w.addField(db.id, { name: 'Urgency', type: 'select', config: { options: ['Now', 'Soon', 'Whenever'] } });
  w.addField(db.id, { name: 'Crew', type: 'text' });
  w.addField(db.id, {
    name: 'Stage',
    type: 'workflow',
    config: {
      states: [
        { id: 'backlog', name: 'Backlog', category: 'not-started', default: true },
        { id: 'doing', name: 'Doing', category: 'in-progress' },
        { id: 'shipped', name: 'Shipped', category: 'done' },
      ],
    },
  });
  const job = w.createEntity(db.id, { Name: 'Re-flash the sign', Stage: 'Doing', Urgency: 'Now', Crew: 'Ada' });
  const priorPass = process.env.WEAVE_APPLET_PASSCODE;
  const priorTable = process.env.WEAVE_APPLET_TABLE;
  process.env.WEAVE_APPLET_PASSCODE = PASSCODE;
  process.env.WEAVE_APPLET_TABLE = 'Ops/Job';
  const { server } = await startServer(w, { port: 0 });
  return {
    base: `http://127.0.0.1:${server.address().port}`, weave: w, db, job,
    stop() {
      server.close();
      if (priorPass === undefined) delete process.env.WEAVE_APPLET_PASSCODE; else process.env.WEAVE_APPLET_PASSCODE = priorPass;
      if (priorTable === undefined) delete process.env.WEAVE_APPLET_TABLE; else process.env.WEAVE_APPLET_TABLE = priorTable;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('applet: the workflow field is discovered, not assumed to be called State', async () => {
  const s = await standStage();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const data = await (await fetch(`${s.base}/t/data`, { headers: { cookie } })).json();
    assert.equal(data.schema.workflow.field, 'Stage');
    assert.deepEqual(data.schema.workflow.states.map((x) => x.name), ['Backlog', 'Doing', 'Shipped']);
    assert.equal(data.items[0].fields.Stage, 'Doing');

    const res = await fetch(`${s.base}/t/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: s.job.id, state: 'Shipped' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).fields.Stage, 'Shipped');
  } finally { s.stop(); }
});

test('applet: the active view follows the workflow categories, not state names', async () => {
  const s = await standStage();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    await fetch(`${s.base}/t/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: s.job.id, state: 'Shipped' }),
    });
    const active = await (await fetch(`${s.base}/t/data?scope=active`, { headers: { cookie } })).json();
    assert.equal(active.items.length, 0, 'a done-category state is not active, whatever it is called');
    const all = await (await fetch(`${s.base}/t/data?scope=all`, { headers: { cookie } })).json();
    assert.equal(all.items.length, 1);
  } finally { s.stop(); }
});

test('applet: a field added to the table shows up with no code change', async () => {
  const s = await standStage();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    s.weave.addField(s.db.id, { name: 'Bay', type: 'number' });
    s.weave.updateEntity(s.job.id, { Bay: 7 });
    const data = await (await fetch(`${s.base}/t/data`, { headers: { cookie } })).json();
    assert.ok(data.schema.fields.some((f) => f.name === 'Bay' && f.type === 'number'), 'the schema carries the new field');
    assert.equal(data.items[0].fields.Bay, 7, 'and the row carries its value');
  } finally { s.stop(); }
});

test('applet: the client renders from the schema rather than a field allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  const client = src.slice(src.indexOf('const CLIENT = `'));
  for (const baked of ['t.priority', 't.due', 't.project', 't.assignee', "'State'"]) {
    assert.ok(!client.includes(baked), `the client must not bake in ${baked}`);
  }
  assert.match(client, /S = data\.schema/, 'the client takes its shape from the schema the server sends');
  assert.match(client, /S\.workflow/, 'the glyph and the swipe read the workflow field from it');
});

test('applet: the page cannot be pinched, and wears the real mark', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const html = await (await fetch(`${s.base}/t`, { headers: { cookie } })).text();
    assert.match(html, /maximum-scale=1/, 'a task list is not a document to zoom around');
    assert.match(html, /gesturestart/, 'Safari ignores user-scalable, so the gesture is refused directly');
    assert.match(html, /brand\/weave-mark-light\.svg/, 'the real mark, not a hand-drawn stand-in');
    assert.match(html, /brand\/weave-mark-dark\.svg/);
  } finally { s.stop(); }
});

/* Kyle, 2026-08-28: "when the page opens always default to opening with
   keyboard up and cursor in new task". Safari only grants focus() inside a
   user gesture and an await spends it, so the order is load-bearing: the
   focus call must come before the unlock request, on the same page. */
test('applet: the unlock tap is spent on the caret before the request', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  const tap = src.slice(src.indexOf("if (buf.length !== 8) return;"), src.indexOf("MOUNT + '/unlock'"));
  assert.match(tap, /raiseKeyboard\(\)/, 'focus happens inside the tap, before any await');
  assert.doesNotMatch(src, /location\.replace\(MOUNT\)/, 'navigating away would spend the gesture');
  assert.match(src, /armFirstTouch/, 'a warm open has no gesture; the first touch supplies one');
});

test('applet: the locked page is the same page, with the keypad over it', async () => {
  const s = await stand();
  try {
    const locked = await (await fetch(`${s.base}/t`)).text();
    assert.match(locked, /wv-compose/, 'the field must exist to be focused inside the unlock tap');
    assert.match(locked, /id="gate"/);
  } finally { s.stop(); }
});

test('applet: the description is written from the page it is read on', async () => {
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const id = s.tasks[1].id;
    const res = await fetch(`${s.base}/t/entity/${id}/doc`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ doc: '## Plan\n\n- call the vendor\n' }),
    });
    assert.equal(res.status, 200);
    assert.match((await res.json()).docHtml, /<h2/, 'it comes back rendered, ready to show');

    const one = await (await fetch(`${s.base}/t/entity/${id}`, { headers: { cookie } })).json();
    assert.match(one.doc, /call the vendor/, 'and raw, ready to edit again');

    assert.equal((await fetch(`${s.base}/t/entity/${id}/doc`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: 'x' }),
    })).status, 401, 'writing prose is still writing');
  } finally { s.stop(); }
});

test('applet: the description answers to the name it has now', async () => {
  // Kyle can rename the description (2026-08-27), and the applet printed the
  // word 'Description' over whatever it was actually showing. The heading and
  // the sheet read the name off the row instead.
  const s = await stand();
  try {
    s.weave.updateField(s.db.id, 'Description', { name: 'Notes' });
    const cookie = cookieFrom(await unlock(s.base));
    const one = await (await fetch(`${s.base}/t/entity/${s.tasks[1].id}`, { headers: { cookie } })).json();
    assert.equal(one.docField, 'Notes', 'the payload says which field the prose came from');

    const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
    assert.match(src, /full\.docField \|\| 'Description'/, 'the detail heading reads the name, not a literal');
    assert.ok(!/<h4>Description<\/h4>/.test(src), 'and neither does the edit sheet');
  } finally { s.stop(); }
});

test('applet: every task it makes starts with the defaults it was given', async () => {
  const prior = process.env.WEAVE_APPLET_DEFAULTS;
  process.env.WEAVE_APPLET_DEFAULTS = JSON.stringify({ Priority: 'P2' });
  const s = await stand();
  try {
    const cookie = cookieFrom(await unlock(s.base));
    const row = await (await fetch(`${s.base}/t/data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Swap the filter' }),
    })).json();
    assert.equal(row.fields.Priority, 'P2', 'the default is applied without the phone asking');
  } finally {
    s.stop();
    if (prior === undefined) delete process.env.WEAVE_APPLET_DEFAULTS; else process.env.WEAVE_APPLET_DEFAULTS = prior;
  }
});

test('applet: a blank deadline or tag set is still a chip you can tap', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  assert.match(src, /emptyOnRow: \['date', 'multiselect'\]/, 'triage happens in the list');
  assert.match(src, /k-empty/, 'and the blank reads as a chip, not as nothing');
  assert.match(src, /editDoc/, 'the description is editable from the task page');
});

/* Kyle, 2026-08-28, from the phone: "cursor doesnt automatically drop me in
   new task with keyboard". Two causes, both pinned here. WebKit grants the
   gesture on click, not pointerdown; and focusing without a gesture puts the
   caret in the field so the user's first real tap lands on an already-focused
   input and raises nothing. */
test('applet: the first tap is spent raising the keyboard, not wasted', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  const arm = src.slice(src.indexOf('function armFirstTouch'), src.indexOf('if (LOCKED)'));
  assert.match(arm, /addEventListener\('click'/, 'WebKit grants the gesture on click, not pointerdown');
  assert.doesNotMatch(arm, /addEventListener\('pointerdown'/);

  const raise = src.slice(src.indexOf('function raiseKeyboard'), src.indexOf('function armFirstTouch'));
  assert.match(raise, /input\.blur\(\)/, 'blur then focus is what re-presents the keyboard');
  assert.match(raise, /input\.focus\(\)/);

  // A coarse pointer must not be given the caret without a gesture: it would
  // spend the first tap on a field that is already focused.
  const warm = src.slice(src.indexOf('const touch = matchMedia'), src.indexOf('})();'));
  assert.match(warm, /if \(!touch\)/, 'only a mouse gets the un-gestured caret');
});

/* Kyle, 2026-08-28: "mobile date selector needs work". A wheel picker is the
   right tool for "the 14th" and the wrong one for "friday". */
test('applet: a date can be tapped, typed, or picked', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  const ed = src.slice(src.indexOf('function editDate'), src.indexOf('The document, written'));
  assert.match(ed, /Today/, 'the answers people actually give come first');
  assert.match(ed, /Tomorrow/);
  assert.match(ed, /Next week/);
  assert.match(ed, /parseNaturalDate/, "weave's own parser reads what they type");
  assert.match(ed, /type="date"/, 'and the native picker is still there for a real calendar');
  assert.match(src, /nl-date\.js/, 'the parser is the shipped one, not a second opinion');
});

test('applet: the natural-language parser it leans on is the one weave ships', async () => {
  const { readFileSync } = await import('node:fs');
  const nl = readFileSync(new URL('../public/nl-date.js', import.meta.url), 'utf8');
  assert.match(nl, /root\.parseNaturalDate = parseNaturalDate/, 'the applet reads it off the window');
});

/* Kyle, 2026-08-28, from the phone: "bug submission bugs are not being
   captured" and "bug icon should be the same as desktop and with same
   funcitnoality". Two causes and one parity gap. */
test('applet: bug reports are asked of the workspace that can file them', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  assert.match(src, /'\/w\/weave\/api\/bug-report'/,
    "on Cloudflare each workspace is its own DO: asked from uno, hub.get('weave') is null and the endpoint 501s");
  assert.doesNotMatch(src, /fetch\('\/api\/bug-report'/, 'the un-prefixed path only works on the node adapter');
});

test('applet: the bug reporter is the desktop one, parts and all', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  for (const part of ['bugCore', 'createRecorder', 'describeTarget', 'clientContext', 'toggleCategory', 'canSubmit']) {
    assert.ok(src.includes(part), `the applet uses bug-core's ${part} rather than its own`);
  }
  assert.match(src, /bug-core\.js/, 'and loads the shipped file, not a copy of it');
  assert.match(src, /rec\.record\(\{ kind: 'api'/, 'requests ride along like they do on the desktop');

  // The face is the desktop's, to the pixel. The box around it is not: a
  // 26px target fails on a finger, so the applet wraps the same face in a
  // 44pt box — right:3px + (44-26)/2 puts the visible mark back on the
  // desktop's own 12px margin, and the bottom offset clears the home
  // indicator the desktop does not have.
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const fab = css.slice(css.indexOf('.bug-fab {'), css.indexOf('.bug-fab {') + 400);
  const flat = src.replace(/\s+/g, ' ');
  for (const prop of ['width: 26px', 'height: 26px', 'border-radius: 7px', 'opacity: .62']) {
    assert.ok(fab.includes(prop), `the desktop FAB is ${prop}`);
    assert.ok(flat.includes(prop.replace(': ', ':')), `and the applet's face matches on ${prop}`);
  }
  assert.ok(fab.includes('right: 12px'), 'the desktop sits 12px in');
  assert.match(flat, /\.wv-bug\{[^}]*right:3px[^}]*width:44px/,
    'the applet sits 3px in with a 44pt box — the same face, back on the same margin');
  assert.match(src, /translate\(12 12\) scale\(1\.42\)/, 'same glyph, same correction scale');
});

test('applet: the keyboard is armed on touchend, which iOS always fires', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/applet.js', import.meta.url), 'utf8');
  const arm = src.slice(src.indexOf('function armFirstTouch'), src.indexOf('if (LOCKED)'));
  assert.match(arm, /addEventListener\('touchend', grab, true\)/,
    'WebKit synthesises no click on a plain div, so a click listener waits forever');
  assert.match(arm, /addEventListener\('click', grab, true\)/, 'click still covers the desktop');
});
