import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
const { WeaveWorkspace } = await import('../../src/worker.js');

const SECRET = "ENOENT: no such file or directory, open '/secret/path/workspace.db'";
const ID = /^[0-9a-f]{8}$/;

function capture() {
  const lines = [];
  const prior = console.error;
  console.error = (...args) => lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
  return { lines, restore: () => { console.error = prior; } };
}

async function serve(applet = false) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  if (applet) process.env.WEAVE_APPLET_PASSCODE = '1234'; else delete process.env.WEAVE_APPLET_PASSCODE;
  const { server, port } = await startServer(w, { port: 0 });
  const call = async (method, path, { body, cookie } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, json: await res.json() };
  };
  return { w, call, stop: () => { server.close(); if (prior == null) delete process.env.WEAVE_APPLET_PASSCODE; else process.env.WEAVE_APPLET_PASSCODE = prior; } };
}

test('an unexpected error answers a generic 500 with a request id, and the detail goes to the server log under that id', async () => {
  const { w, call, stop } = await serve();
  const log = capture();
  try {
    w.listSpaces = () => { throw new Error(SECRET); };
    const { status, json } = await call('GET', '/api/spaces');
    assert.equal(status, 500);
    assert.equal(json.code, 'internal');
    assert.match(json.id, ID, 'a short request id');
    assert.ok(!JSON.stringify(json).includes('/secret/path'), `the body leaks the path: ${JSON.stringify(json)}`);
    assert.ok(!JSON.stringify(json).includes('ENOENT'), 'nor the errno');
    const logged = log.lines.find((l) => l.includes(json.id));
    assert.ok(logged, `the log names ${json.id}: ${log.lines.join('|')}`);
    assert.ok(logged.includes('/secret/path'), 'and carries the detail');
  } finally { log.restore(); stop(); }
});

test('a WeaveError still answers its own message and code', async () => {
  const { call, stop } = await serve();
  try {
    const { status, json } = await call('GET', '/api/tables/Nope/entities');
    assert.equal(status, 404);
    assert.equal(json.code, 'not-found');
    assert.match(json.error, /Nope/);
    assert.equal(json.id, undefined);
  } finally { stop(); }
});

test('the applet answers the same generic 500', async () => {
  const { w, call, stop } = await serve(true);
  const log = capture();
  try {
    const unlock = await call('POST', '/t/unlock', { body: { passcode: '1234' } });
    assert.equal(unlock.status, 200);
    const cookie = unlock.headers.get('set-cookie').split(';')[0];
    w.getTable = () => { throw new Error(SECRET); };
    const { status, json } = await call('GET', '/t/data', { cookie });
    assert.equal(status, 500);
    assert.equal(json.code, 'internal');
    assert.match(json.id, ID);
    assert.ok(!JSON.stringify(json).includes('/secret/path'), JSON.stringify(json));
    assert.ok(log.lines.some((l) => l.includes(json.id) && l.includes('/secret/path')));
  } finally { log.restore(); stop(); }
});

function shimStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    sql: {
      exec(query, ...params) {
        if (params.length === 0 && !/^\s*SELECT/i.test(query)) db.exec(query);
        const stmt = db.prepare(query);
        if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) };
        stmt.run(...params);
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
}

test('the Worker answers a generic body for an error outside the dispatcher', async () => {
  const dobj = new WeaveWorkspace({ storage: shimStorage() }, { WEAVE_VERSION: '0.0.0-test' });
  const log = capture();
  try {
    const res = await dobj.fetch(new Request('http://do/api/%zz', { headers: { 'x-weave-workspace': 'scratch' } }));
    const json = await res.json();
    assert.equal(res.status, 500);
    assert.equal(json.code, 'internal');
    assert.match(json.id, ID);
    assert.ok(!/malformed/i.test(json.error), JSON.stringify(json));
    assert.ok(log.lines.some((l) => l.includes(json.id)));
  } finally { log.restore(); }
});
