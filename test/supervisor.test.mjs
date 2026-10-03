/* In-place self-update (Feature #250, Kyle, 2026-10-02). `weave supervise`
   holds the public port and runs the server as a child worker; on a newer
   release whose tag is on grunion-ai/weave main it unpacks the tag into
   <data dir>/releases/v<version>/, starts a second worker beside the first,
   moves new requests to it once its /api/health answers, lets the old one
   drain and exit, and only then lets the new one write its open-time
   migrations. GitHub is a fake here: the releases, compare and tarball
   answers come from an injected fetch, and the "release" is this checkout's
   bin/ and src/ under a higher version number. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './lib/source.mjs';
import { bootAndStop } from './lib/serve-fixture.mjs';
import { packTar } from '../src/backup.js';
import { Weave, deferMigrations, runDeferredMigrations } from '../src/engine.js';
import { startSupervisor, autoUpdateFromEnv, unpackRelease, REPO_API } from '../src/supervisor.js';
import { RELEASES_URL } from '../src/update-check.js';

const BIN = join(ROOT, 'bin', 'weave.js');
const IMAGE_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const NEXT = '9.9.9';
const SHA = 'a'.repeat(40);
const ENV = { ...process.env, WEAVE_UPDATE_CHECK: 'off' };
delete ENV.WEAVE_AUTO_UPDATE;
delete ENV.WEAVE_DEFER_MIGRATIONS;
const scratch = mkdtempSync(join(tmpdir(), 'weave-supervise-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/* A GitHub-shaped tarball (one top-level directory) of this checkout's
   server, versioned `version`. `bin` replaces bin/weave.js when given. */
function releaseTarball(version, { bin = null } = {}) {
  const top = `grunion-ai-weave-${SHA.slice(0, 7)}/`;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const entries = [{ name: top + 'package.json', data: Buffer.from(JSON.stringify({ ...pkg, version })) }];
  // The server: bin/, src/ and public/, which src/ imports from too.
  for (const dir of ['bin', 'src', 'public']) {
    for (const p of walk(join(ROOT, dir))) {
      const name = top + relative(ROOT, p);
      entries.push(bin && name.endsWith('bin/weave.js') ? { name, data: Buffer.from(bin) } : { name, path: p });
    }
  }
  const file = join(mkdtempSync(join(scratch, 'tar-')), 'r.tar');
  packTar(file, entries);
  return gzipSync(readFileSync(file));
}

/* The three GitHub answers the supervisor reads, plus a log of what it asked. */
function fakeGitHub({ version = NEXT, compare = 'ahead', tarball = () => releaseTarball(version) } = {}) {
  const calls = [];
  let tgz = null;
  const fetch = async (url) => {
    url = String(url);
    calls.push(url);
    if (url === RELEASES_URL) return Response.json({ tag_name: `v${version}` });
    if (url === `${REPO_API}/compare/v${version}...main`) return Response.json({ status: compare, base_commit: { sha: SHA } });
    if (url === `${REPO_API}/tarball/${SHA}`) return new Response((tgz ??= tarball()));
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

/* Seeding the docs workspace beside a workspace is most of a first boot
   (over a minute at a load of 100). A data file that is itself the docs
   workspace skips the seed, so every test starts from a copy of a bare one. */
const FIXTURE = join(scratch, 'fixture');
test.before(() => {
  mkdirSync(FIXTURE);
  const w = new Weave({ path: join(FIXTURE, 'weave.db') });
  w.state.meta.name = 'weave';
  w.save();
  w.store.close();
});
function dataDir(name) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(FIXTURE)) copyFileSync(join(FIXTURE, f), join(dir, f));
  return join(dir, 'weave.db');
}

async function supervise(dataPath, gh, extra = {}) {
  const events = [];
  const sup = await startSupervisor({
    port: 0, host: '127.0.0.1', dataPath, env: ENV, fetch: gh.fetch,
    interval: 0, healthTimeoutMs: 60_000, log: { log() {}, warn() {}, error() {} },
    onEvent: (e) => events.push({ ...e, t: Date.now() }),
    onWorkerDied: () => { throw new Error('a worker died under the supervisor'); },
    ...extra,
  });
  return { sup, events, base: `http://127.0.0.1:${sup.port}` };
}

const health = async (base) => (await fetch(`${base}/api/health`)).json();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('WEAVE_AUTO_UPDATE is opt-in: unset, "0" or "off" leave supervise as plain serve', async () => {
  for (const v of [undefined, '', '0', 'off', 'no', 'false']) assert.equal(autoUpdateFromEnv(v === undefined ? {} : { WEAVE_AUTO_UPDATE: v }), false, `WEAVE_AUTO_UPDATE=${v}`);
  for (const v of ['1', 'true', 'yes', 'on']) assert.equal(autoUpdateFromEnv({ WEAVE_AUTO_UPDATE: v }), true, `WEAVE_AUTO_UPDATE=${v}`);
  const dataPath = dataDir('plain');
  const child = spawn(process.execPath, [BIN, 'supervise', '--port', '0', '--data', dataPath], { stdio: ['ignore', 'pipe', 'pipe'], env: ENV });
  let port = null;
  child.stdout.on('data', (d) => { port ??= /Weave running at http:\/\/[^:]+:(\d+)/.exec(String(d))?.[1] ?? null; });
  const log = await bootAndStop(child, { timeout: 60_000 });
  assert.match(log, /Weave running at/, 'supervise without the variable is serve: it prints the serve banner');
  assert.doesNotMatch(log, /supervise:/, 'and no supervisor started');
  assert.ok(!existsSync(join(dataPath, '..', 'releases')), 'nothing written under releases/');
});

test('a swap under a request loop answers every request, and the old worker exits', async () => {
  const dataPath = dataDir('swap');
  const gh = fakeGitHub();
  const { sup, base, events } = await supervise(dataPath, gh);
  try {
    const first = await health(base);
    assert.equal(first.version, IMAGE_VERSION);
    assert.equal(first.supervisor.release, 'image');
    const oldPid = first.supervisor.pid;
    // A table to write into, so the loop carries writes across the swap too.
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await post('/api/spaces', { name: 'Load' });
    const table = await (await post('/api/tables', { space: 'Load', name: 'Hit' })).json();

    let stop = false;
    const failures = [];
    const versions = [];
    let requests = 0;
    const loop = async (i) => {
      for (let n = 0; !stop; n++) {
        try {
          const r = n % 3 === 2
            ? await post(`/api/tables/${table.id}/entities`, { name: `hit ${i}.${n}` })
            : await fetch(`${base}/api/health`);
          const body = await r.json();
          requests++;
          if (!r.ok) failures.push(`HTTP ${r.status} ${JSON.stringify(body)}`);
          else if (body.version && versions.at(-1) !== body.version) versions.push(body.version);
        } catch (err) {
          failures.push(err.message);
        }
      }
    };
    const loops = Array.from({ length: 6 }, (_, i) => loop(i));
    await new Promise((r) => setTimeout(r, 300));
    const result = await sup.check();
    await new Promise((r) => setTimeout(r, 300));
    stop = true;
    await Promise.all(loops);

    assert.equal(result.action, 'swapped', JSON.stringify(result));
    assert.deepEqual(failures, [], `no request failed across the swap (${requests} sent)`);
    assert.deepEqual(versions, [IMAGE_VERSION, NEXT], 'the loop saw the old version, then the new one, never back');
    const after = await health(base);
    assert.equal(after.version, NEXT);
    assert.equal(after.supervisor.release, `v${NEXT}`);
    assert.equal(after.supervisor.dir, join(dataPath, '..', 'releases', `v${NEXT}`));
    assert.equal(after.supervisor.lastSwap.ok, true);
    assert.equal(after.supervisor.lastSwap.from, 'image');
    assert.equal(after.supervisor.lastSwap.to, `v${NEXT}`);
    assert.ok(Date.parse(after.supervisor.lastSwap.at));
    assert.ok(!alive(oldPid), 'the old worker exited');
    assert.deepEqual(events.map((e) => e.type), ['switched', 'old-exited', 'migrated']);
    const rows = (await (await post(`/api/tables/${table.id}/query`, {})).json()).total;
    assert.ok(rows > 0, 'writes from both sides of the swap are in the workspace');
    // Nothing newer: a second check changes nothing.
    assert.equal((await sup.check()).action, 'current');
  } finally {
    await sup.close();
  }
  // The volume now holds a release that passed: the next boot starts on it without asking GitHub.
  const gh2 = fakeGitHub({ version: NEXT });
  const again = await supervise(dataPath, gh2);
  try {
    const h = await health(again.base);
    assert.equal(h.version, NEXT);
    assert.equal(h.supervisor.release, `v${NEXT}`);
    assert.deepEqual(gh2.calls, [], 'boot reads the volume, not GitHub');
  } finally {
    await again.sup.close();
  }
});

test('the open-time migrations wait for the old worker to exit', async () => {
  const dataPath = dataDir('migrate');
  const { sup, base, events } = await supervise(dataPath, fakeGitHub());
  try {
    const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await post('/api/spaces', { name: 'M' });
    const table = await post('/api/tables', { space: 'M', name: 'Note' });
    // Leave a field out of the table's stored order, the way a workspace
    // written by a build without that normalisation would be. Every open
    // repairs it (#reconcileFieldOrder); the running worker has opened already.
    const db = new DatabaseSync(dataPath);
    db.exec('PRAGMA busy_timeout = 5000');
    const order = () => JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(table.id).json).fieldOrder;
    const full = order();
    const row = JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(table.id).json);
    row.fieldOrder = full.slice(1);
    db.prepare('UPDATE tables SET json = ? WHERE id = ?').run(JSON.stringify(row), table.id);
    const seen = {};
    const watch = (type) => events.find((e) => e.type === type);
    const result = await sup.check({
      onEvent: (e) => { seen[e.type] = order().length; },
    });
    assert.equal(result.action, 'swapped', JSON.stringify(result));
    assert.ok(watch('switched') && watch('old-exited') && watch('migrated'));
    assert.equal(seen.switched, full.length - 1, 'serving from the new worker: its migration is not on disk yet');
    assert.equal(seen['old-exited'], full.length - 1, 'old worker gone: still not on disk');
    assert.equal(seen.migrated, full.length, 'after the old worker exited the new one wrote its migration');
    assert.deepEqual([...order()].sort(), [...full].sort());
    db.close();
  } finally {
    await sup.close();
  }
});

test('the engine holds every write made while migrations are deferred, then settles them', () => {
  const dir = mkdtempSync(join(scratch, 'defer-'));
  const path = join(dir, 'ws.db');
  const w = new Weave({ path });
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'T' });
  w.store.close();
  const db = new DatabaseSync(path);
  const order = () => JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(t.id).json).fieldOrder;
  const full = order();
  const row = JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(t.id).json);
  db.prepare('UPDATE tables SET json = ? WHERE id = ?').run(JSON.stringify({ ...row, fieldOrder: full.slice(1) }), t.id);
  let held;
  deferMigrations();
  try {
    held = new Weave({ path });
    assert.deepEqual([...held.state.tables[t.id].fieldOrder].sort(), [...full].sort(), 'in memory the open repaired the order');
    assert.deepEqual(order(), full.slice(1), 'on disk nothing moved');
  } finally {
    runDeferredMigrations();
  }
  assert.deepEqual([...order()].sort(), [...full].sort(), 'settled: the repair is on disk');
  held.store.close();
  db.close();
});

/* The live swap on 2026-10-03 (v0.4.57 -> v0.4.58 on Railway) stalled every
   request for about ten seconds after the switch: settling forced a full
   rewrite of each workspace (every entity row and its search entry) inside
   the worker that had just started serving, on a volume where that is slow.
   A settle writes what the deferred open changed, and nothing else. */
test('settling a deferred open writes only what it changed, not every row', () => {
  const dir = mkdtempSync(join(scratch, 'settle-'));
  const path = join(dir, 'ws.db');
  const w = new Weave({ path });
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'T' });
  const rows = new Set();
  for (let i = 0; i < 20; i++) rows.add(w.createEntity(t.id, { Name: `row ${i}` }).id);
  w.store.close();
  const db = new DatabaseSync(path);
  const row = JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(t.id).json);
  const full = row.fieldOrder;
  db.prepare('UPDATE tables SET json = ? WHERE id = ?').run(JSON.stringify({ ...row, fieldOrder: full.slice(1) }), t.id);
  db.exec(`CREATE TABLE entity_writes (id TEXT);
    CREATE TRIGGER count_insert AFTER INSERT ON entities BEGIN INSERT INTO entity_writes VALUES (new.id); END;
    CREATE TRIGGER count_update AFTER UPDATE ON entities BEGIN INSERT INTO entity_writes VALUES (new.id); END;`);
  const written = () => db.prepare('SELECT id FROM entity_writes').all().map((r) => r.id);
  let held;
  deferMigrations();
  try {
    held = new Weave({ path });
  } finally {
    runDeferredMigrations();
  }
  const order = JSON.parse(db.prepare('SELECT json FROM tables WHERE id = ?').get(t.id).json).fieldOrder;
  assert.deepEqual([...order].sort(), [...full].sort(), 'the repair landed');
  // The table's own Workspace/Tables row mirrors its Field Order, so it is
  // the one row the repair rewrites; before the fix all 41 rows were.
  assert.deepEqual(written().filter((id) => rows.has(id)), [], 'no data row was rewritten to land a table repair');
  assert.ok(written().length <= 1, `only the table's registry row moved (${written().length} written)`);
  held.store.close();
  db.close();
});

test('a release whose health check fails leaves the old worker serving, and is not retried', async () => {
  const dataPath = dataDir('unhealthy');
  const gh = fakeGitHub({ tarball: () => releaseTarball(NEXT, { bin: 'process.exit(3);\n' }) });
  const { sup, base, events } = await supervise(dataPath, gh);
  try {
    const before = await health(base);
    const result = await sup.check();
    assert.equal(result.action, 'failed');
    assert.match(result.reason, /exited/);
    const after = await health(base);
    assert.equal(after.version, IMAGE_VERSION, 'still the old version');
    assert.equal(after.supervisor.pid, before.supervisor.pid, 'the same worker');
    assert.equal(after.supervisor.lastSwap.ok, false);
    assert.equal(after.supervisor.lastSwap.to, `v${NEXT}`);
    assert.deepEqual(after.supervisor.failed, [NEXT]);
    assert.ok(!events.some((e) => e.type === 'switched'), 'no request ever went to it');
    const tarballs = () => gh.calls.filter((u) => u.includes('/tarball/')).length;
    assert.equal(tarballs(), 1);
    const again = await sup.check();
    assert.equal(again.action, 'skipped', 'the same release is not tried twice');
    assert.equal(tarballs(), 1, 'and not downloaded again');
  } finally {
    await sup.close();
  }
});

test('a tag whose commit is not on main is refused before anything is downloaded', async () => {
  for (const status of ['diverged', 'behind']) {
    const dataPath = dataDir(`off-main-${status}`);
    const gh = fakeGitHub({ compare: status });
    const { sup, base } = await supervise(dataPath, gh);
    try {
      const result = await sup.check();
      assert.equal(result.action, 'failed');
      assert.match(result.reason, /not on grunion-ai\/weave main/);
      assert.ok(!gh.calls.some((u) => u.includes('/tarball/')), 'no tarball was fetched');
      assert.ok(!existsSync(join(dataPath, '..', 'releases', `v${NEXT}`)), 'nothing unpacked');
      const h = await health(base);
      assert.equal(h.version, IMAGE_VERSION);
      assert.deepEqual(h.supervisor.failed, [NEXT]);
    } finally {
      await sup.close();
    }
  }
});

test('a GitHub outage is not a verdict: the release is tried again on the next check', async () => {
  const dataPath = dataDir('outage');
  let down = true;
  const gh = fakeGitHub();
  const fetch = (url) => (down && String(url).includes('/compare/') ? Promise.resolve(new Response('rate limited', { status: 403 })) : gh.fetch(url));
  const { sup } = await supervise(dataPath, { fetch, calls: gh.calls });
  try {
    const first = await sup.check();
    assert.equal(first.action, 'failed');
    assert.equal(first.retry, true);
    down = false;
    assert.equal((await sup.check()).action, 'swapped');
  } finally {
    await sup.close();
  }
});

test('unpackRelease strips the top directory and refuses an entry that climbs out', () => {
  const dir = mkdtempSync(join(scratch, 'unpack-'));
  const tar = join(dir, 'a.tar');
  packTar(tar, [{ name: 'top/package.json', data: Buffer.from('{"version":"1.2.3"}') }, { name: 'top/src/x.js', data: Buffer.from('x') }]);
  unpackRelease(gzipSync(readFileSync(tar)), join(dir, 'out'));
  assert.equal(readFileSync(join(dir, 'out', 'src', 'x.js'), 'utf8'), 'x');
  packTar(tar, [{ name: 'top/../../evil.js', data: Buffer.from('x') }]);
  assert.throws(() => unpackRelease(gzipSync(readFileSync(tar)), join(dir, 'out2')), /escapes/);
  assert.ok(!existsSync(join(dir, 'evil.js')));
});
