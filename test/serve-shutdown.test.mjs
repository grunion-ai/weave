import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { request } from 'node:http';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { backup, restore, heldOpen } from '../src/backup.js';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const scratch = tempDir('weave-serve-shutdown-');
const ENV = { ...process.env, HOME: join(scratch, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_TRACKER_CANONICAL: '1', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'PORT']) delete ENV[k];
const WORKSPACES = ['alpha', 'beta'];
let made = 0;
const fresh = (label) => {
  const dir = join(scratch, `${label}-${++made}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

function dataDir() {
  const dir = fresh('data');
  for (const name of WORKSPACES) {
    const w = new Weave({ path: join(dir, `${name}.db`) });
    w.state.meta.name = name;
    w.createSpace({ name: 'Ops' });
    w.createTable({ space: 'Ops', name: 'Task' });
    w.createEntity('Ops/Task', { name: `${name} before the server` });
    w.store.close();
  }
  const docs = new Weave({ path: join(dir, 'weave.db') });
  docs.state.meta.name = 'weave';
  docs.save();
  docs.store.close();
  return dir;
}

function has(db, name) {
  const w = new Weave({ path: db });
  try { return Boolean(w.findEntity('Ops/Task', name)); } finally { w.store.close(); }
}

function copiedAlone(db) {
  const copy = join(fresh('copy'), 'copy.db');
  copyFileSync(db, copy);
  return copy;
}

const sidecars = (dir) => ['alpha', 'beta', 'weave'].flatMap((n) => ['-wal', '-shm'].map((s) => join(dir, `${n}.db${s}`))).filter((p) => existsSync(p));

async function serving(dir) {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', join(dir, 'alpha.db')], {
    cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = Promise.all([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    ...[child.stdout, child.stderr].map((stream) => new Promise((resolve) => stream.once('close', resolve))),
  ]).then(([status]) => status);
  const { port } = await new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m?.weave === 'listening') resolve(m); });
    exited.then(({ code, signal }) => reject(new Error(`weave serve exited (${signal ?? code}) before it listened:\n${log}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    write: (workspace, name) => fetch(`${base}${workspace === 'alpha' ? '' : `/w/${workspace}`}/api/tables/Task/entities`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    }),
    stop: async (how) => {
      if (child.exitCode === null && child.signalCode === null) {
        if (how === 'disconnect') child.disconnect(); else child.kill(how);
      }
      return { ...(await exited), log };
    },
    kill: () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); return exited; },
  };
}

async function writesThenStops(how, { dir = dataDir(), during = () => {} } = {}) {
  const server = await serving(dir);
  try {
    for (const name of WORKSPACES) {
      const r = await server.write(name, `${name} written while serving`);
      assert.ok(r.ok, `${name} took the write: ${r.status} ${await r.text()}`);
    }
    await during(dir);
    return await server.stop(how);
  } finally {
    await server.kill();
  }
}

function assertClosedCleanly(dir, how, stopped) {
  assert.deepEqual({ code: stopped.code, signal: stopped.signal }, { code: 0, signal: null }, `${how} stops weave serve with exit code 0:\n${stopped.log}`);
  assert.ok(stopped.log.includes(`Weave stopped (${how === 'disconnect' ? 'IPC channel closed' : how}): 3 workspaces closed\n`), `${how}: the last line counts the docs workspace, alpha and beta:\n${stopped.log}`);
  assert.deepEqual(sidecars(dir), [], `${how}: every workspace was closed, so SQLite folded each WAL into its .db and removed the sidecars`);
  for (const name of WORKSPACES) {
    const db = join(dir, `${name}.db`);
    assert.equal(heldOpen(db), false, `${how}: nothing holds ${name}.db`);
    const copy = copiedAlone(db);
    assert.ok(has(copy, `${name} written while serving`), `${how}: a copy of ${name}.db alone holds the row the server wrote`);
    assert.ok(has(copy, `${name} before the server`), `${how}: and the rows it held before`);
  }
}

test('SIGTERM closes every workspace before weave serve exits: each .db alone holds the rows its WAL held, no sidecar stays, and restore asks for --force instead of calling the target held open (Issue #1661)', { timeout: 120_000 }, async () => {
  const dir = dataDir();
  const archive = (await backup({ dataDir: dir, out: fresh('out'), env: {} })).path;
  const stopped = await writesThenStops('SIGTERM', {
    dir,
    during: () => {
      assert.ok(existsSync(join(dir, 'alpha.db-wal')), 'the server writes through the WAL');
      assert.ok(!has(copiedAlone(join(dir, 'alpha.db')), 'alpha written while serving'), 'while the server runs, a copy of alpha.db alone lacks the row the WAL holds');
    },
  });
  assertClosedCleanly(dir, 'SIGTERM', stopped);
  await assert.rejects(restore({ source: archive, dataDir: dir, env: {} }), (err) => err.code === 'conflict' && /\.db exists/.test(err.message) && !/held open/.test(err.message));
  const r = await restore({ source: archive, dataDir: dir, env: {}, force: true });
  assert.ok(WORKSPACES.every((n) => r.landed.includes(`${n}.db`)));
  assert.deepEqual(sidecars(dir), []);
  assert.ok(has(join(dir, 'alpha.db'), 'alpha before the server'), 'the archive landed');
  assert.ok(!has(join(dir, 'alpha.db'), 'alpha written while serving'), 'the restored file is the archive');
});

test('SIGINT and a closed IPC channel close every workspace the same way (Issue #1661)', { timeout: 120_000 }, async () => {
  for (const how of ['SIGINT', 'disconnect']) {
    const dir = dataDir();
    assertClosedCleanly(dir, how, await writesThenStops(how, { dir }));
  }
});

function workspaceFiles() {
  const dir = fresh('inproc');
  const open = WORKSPACES.map((name) => {
    const w = new Weave({ path: join(dir, `${name}.db`) });
    w.state.meta.name = name;
    w.createSpace({ name: 'Ops' });
    w.createTable({ space: 'Ops', name: 'Task' });
    return w;
  });
  open[1].store.close();
  return { dir, w: open[0], db: join(dir, 'alpha.db') };
}

const refused = (port) => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', (err) => resolve(err.code === 'ECONNREFUSED'));
});

async function untilRefused(port) {
  for (let i = 0; i < 200; i++) {
    if (await refused(port)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

test('a request in flight when the server stops still answers on a closing connection, and its write is in the file once every store is closed (Issue #1661)', { timeout: 120_000 }, async () => {
  const { dir, w, db } = workspaceFiles();
  const { server, port } = await startServer(w, { port: 0 });
  const body = JSON.stringify({ name: 'Written across the stop' });
  let req = null;
  let stopping = null;
  let shut = null;
  try {
    const answer = await new Promise((resolve, reject) => {
      req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/tables/Task/entities', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Expect: '100-continue' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.on('continue', async () => {
        try {
          stopping = server.shutdown();
          shut = await untilRefused(port);
          req.end(body);
        } catch (err) { reject(err); }
      });
      req.flushHeaders();
    });
    assert.equal(shut, true, 'the stopping server took no new connection while the write was in flight');
    assert.ok(answer.status >= 200 && answer.status < 300, `the in-flight write answered: ${answer.status} ${answer.text}`);
    assert.equal(answer.connection, 'close', 'the answer tells the client not to reuse the connection');
    assert.deepEqual(await stopping, { workspaces: 2, cut: 0 }, 'both workspaces closed and nothing was cut off');
    assert.equal(heldOpen(db), false, 'the store is closed');
    assert.deepEqual(sidecars(dir), []);
    assert.ok(has(copiedAlone(db), 'Written across the stop'), 'the write made while stopping is in alpha.db alone');
    assert.equal(server.shutdown(), stopping, 'a second stop waits on the first');
  } finally {
    req?.destroy();
    server.closeAllConnections();
    server.close();
  }
});

test('a request that never finishes holds the stop for the drain bound only, then every store still closes (Issue #1661)', { timeout: 120_000 }, async () => {
  const { dir, w, db } = workspaceFiles();
  const { server, port } = await startServer(w, { port: 0 });
  let req = null;
  try {
    const { ended } = await new Promise((resolve, reject) => {
      req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/tables/Task/entities', headers: { 'Content-Type': 'application/json', 'Content-Length': 1000, Expect: '100-continue' } });
      const done = new Promise((settled) => { req.on('error', settled); req.on('response', (res) => { res.resume(); res.on('close', settled); }); });
      req.on('error', reject);
      req.on('continue', () => { req.write('{"name":'); resolve({ ended: done }); });
    });
    const t0 = Date.now();
    const stopped = await server.shutdown({ drainMs: 300 });
    const took = Date.now() - t0;
    await ended;
    assert.deepEqual(stopped, { workspaces: 2, cut: 1 }, 'the unfinished request was cut off and both workspaces closed');
    assert.ok(took >= 250 && took < 5000, `the stop waited for the drain bound and no longer: ${took} ms`);
    assert.equal(heldOpen(db), false, 'the store is closed');
    assert.deepEqual(sidecars(dir), []);
  } finally {
    req?.destroy();
    server.closeAllConnections();
    server.close();
  }
});
