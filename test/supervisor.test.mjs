import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, statSync, copyFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './lib/source.mjs';
import { bootAndStop } from './lib/serve-fixture.mjs';
import { packTar } from '../src/backup.js';
import { Weave, deferMigrations, runDeferredMigrations } from '../src/engine.js';
import { startSupervisor, autoUpdateFromEnv, unpackRelease, pruneReleases, REPO_API } from '../src/supervisor.js';
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

function releaseTarball(version, { bin = null } = {}) {
  const top = `grunion-ai-weave-${SHA.slice(0, 7)}/`;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const entries = [{ name: top + 'package.json', data: Buffer.from(JSON.stringify({ ...pkg, version })) }];
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
const releasesOf = (dataPath) => readdirSync(join(dataPath, '..', 'releases')).sort();

function plantRelease(releasesDir, name, { version = name.slice(1), served = null } = {}) {
  const dir = join(releasesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'weave', version }));
  if (served) writeFileSync(join(dir, '.weave-release-ok'), served);
  return dir;
}
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
    assert.equal((await sup.check()).action, 'current');
  } finally {
    await sup.close();
  }
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
  assert.deepEqual(written().filter((id) => rows.has(id)), [], 'no data row was rewritten to land a table repair');
  assert.ok(written().length <= 1, `only the table's registry row moved (${written().length} written)`);
  held.store.close();
  db.close();
});

test('the image worker names the commit Railway built it from; anything but a full SHA names none', async () => {
  const built = 'd'.repeat(40);
  for (const [given, named] of [[built, built], ['main', null], [built.slice(0, 7), null], [undefined, null]]) {
    const dataPath = dataDir(`image-commit-${named ? 'sha' : String(given)}`);
    const env = { ...ENV, ...(given ? { RAILWAY_GIT_COMMIT_SHA: given } : {}) };
    if (!given) delete env.RAILWAY_GIT_COMMIT_SHA;
    const { sup, base } = await supervise(dataPath, fakeGitHub(), { env });
    try {
      const h = await health(base);
      assert.equal(h.supervisor.release, 'image');
      assert.equal(h.supervisor.commit, named, `RAILWAY_GIT_COMMIT_SHA=${given}`);
    } finally {
      await sup.close();
    }
  }
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
    assert.deepEqual(releasesOf(dataPath), ['state.json'], 'the failed release folder is gone; state.json still names it failed');
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

function plantedReleases() {
  const dir = join(mkdtempSync(join(scratch, 'prune-')), 'releases');
  plantRelease(dir, 'v0.0.1', { served: '2026-10-01T00:00:00.000Z' });
  plantRelease(dir, 'v0.0.2', { served: '2026-10-02T00:00:00.000Z' });
  plantRelease(dir, 'v0.0.3', { served: '2026-10-03T00:00:00.000Z' });
  plantRelease(dir, 'v0.0.4');
  plantRelease(dir, 'v0.0.5.part', { version: '0.0.5' });
  plantRelease(dir, `c${SHA}`, { version: '0.0.6', served: '2026-09-30T00:00:00.000Z' });
  writeFileSync(join(dir, 'state.json'), '{}');
  return dir;
}

test('pruning keeps the serving folder and the most recently served good one, and never state.json', () => {
  const dir = plantedReleases();
  const removed = pruneReleases(dir, { serving: join(dir, `c${SHA}`), failed: { '0.0.3': {} } });
  assert.deepEqual(readdirSync(dir).sort(), [`c${SHA}`, 'state.json', 'v0.0.2']);
  assert.deepEqual(removed.sort(), ['v0.0.1', 'v0.0.3', 'v0.0.4', 'v0.0.5.part']);
});

test('pruning while the image serves keeps only the newest good folder', () => {
  const dir = plantedReleases();
  pruneReleases(dir, { serving: ROOT, failed: { '0.0.3': {} } });
  assert.deepEqual(readdirSync(dir).sort(), ['state.json', 'v0.0.2']);
  const bare = join(mkdtempSync(join(scratch, 'prune-')), 'releases');
  plantRelease(bare, 'v0.0.7');
  pruneReleases(bare, { serving: ROOT, failed: {} });
  assert.deepEqual(readdirSync(bare), [], 'no good folder: nothing is kept');
  assert.deepEqual(pruneReleases(join(scratch, 'no-such-releases'), { serving: ROOT, failed: {} }), []);
});

test('a folder pruning cannot remove is logged, and pruning does not throw', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, () => {
  const dir = plantedReleases();
  const warnings = [];
  chmodSync(dir, 0o555);
  try {
    assert.doesNotThrow(() => pruneReleases(dir, { serving: join(dir, `c${SHA}`), failed: {}, log: { warn: (m) => warnings.push(m) } }));
  } finally {
    chmodSync(dir, 0o755);
  }
  assert.ok(warnings.some((m) => /v0\.0\.1/.test(m)), warnings.join('\n'));
});

test('a boot that serves the image keeps only the newest good release folder', async () => {
  const dataPath = dataDir('boot-prune');
  const dir = join(dataPath, '..', 'releases');
  plantRelease(dir, 'v0.0.1', { served: '2026-10-01T00:00:00.000Z' });
  plantRelease(dir, 'v0.0.2', { served: '2026-10-02T00:00:00.000Z' });
  plantRelease(dir, 'v0.0.3', { served: '2026-10-03T00:00:00.000Z' });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ failed: { '0.0.3': { at: '2026-10-03T00:00:00.000Z', reason: 'unhealthy' } } }));
  const { sup, base } = await supervise(dataPath, fakeGitHub());
  try {
    assert.equal((await health(base)).supervisor.release, 'image');
    assert.deepEqual(releasesOf(dataPath), ['state.json', 'v0.0.2']);
  } finally {
    await sup.close();
  }
});

function fakeMain({ heads, tarball = () => releaseTarball(NEXT) }) {
  const calls = [];
  const tgz = new Map();
  const fetch = async (url) => {
    url = String(url);
    calls.push(url);
    if (url === `${REPO_API}/commits/main`) return Response.json({ sha: heads.main });
    const sha = /\/tarball\/([0-9a-f]{40})$/.exec(url)?.[1];
    if (sha) return new Response(tgz.get(sha) ?? tgz.set(sha, tarball(sha)).get(sha));
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

const TRACK = { ...ENV, WEAVE_TRACK: 'main' };
const MAIN_A = 'b'.repeat(40);
const MAIN_B = 'c'.repeat(40);
const MAIN_C = 'd'.repeat(40);

test('tracking main swaps to each new main commit, keyed by commit, without a release', async () => {
  const dataPath = dataDir('track-main');
  const heads = { main: MAIN_A };
  const gh = fakeMain({ heads });
  const { sup, base } = await supervise(dataPath, gh, { env: TRACK });
  try {
    const first = await sup.check();
    assert.equal(first.action, 'swapped');
    let h = await health(base);
    assert.equal(h.supervisor.commit, MAIN_A);
    assert.equal(h.supervisor.release, `c${MAIN_A}`);
    assert.ok(!gh.calls.some((u) => u.includes('/compare/') || u.includes('/releases')), 'no release or compare lookup');
    assert.equal((await sup.check()).action, 'current', 'the same commit is not installed twice');
    heads.main = MAIN_B;
    assert.equal((await sup.check()).action, 'swapped');
    h = await health(base);
    assert.equal(h.supervisor.commit, MAIN_B);
    assert.deepEqual(readdirSync(join(dataPath, '..', 'releases')).filter((n) => n.startsWith('c')).sort(), [`c${MAIN_A}`, `c${MAIN_B}`]);
    heads.main = MAIN_C;
    assert.equal((await sup.check()).action, 'swapped');
    assert.deepEqual(releasesOf(dataPath), [`c${MAIN_B}`, `c${MAIN_C}`, 'state.json'], 'the oldest commit folder is pruned on the next swap');
  } finally {
    await sup.close();
  }
});

test('a main commit that fails its health check rolls back to the serving worker and is skipped until main moves', async () => {
  const dataPath = dataDir('track-unhealthy');
  const heads = { main: MAIN_A };
  const gh = fakeMain({ heads, tarball: (sha) => (sha === MAIN_A ? releaseTarball(NEXT, { bin: 'process.exit(3);\n' }) : releaseTarball(NEXT)) });
  const { sup, base } = await supervise(dataPath, gh, { env: TRACK });
  try {
    const before = await health(base);
    const failed = await sup.check();
    assert.equal(failed.action, 'failed');
    const after = await health(base);
    assert.equal(after.supervisor.pid, before.supervisor.pid, 'the old worker keeps serving');
    assert.deepEqual(after.supervisor.failed, [MAIN_A]);
    assert.equal((await sup.check()).action, 'skipped');
    assert.deepEqual(releasesOf(dataPath), ['state.json'], 'the failed commit folder is gone');
    heads.main = MAIN_B;
    assert.equal((await sup.check()).action, 'swapped', 'the next main commit deploys');
    assert.equal((await health(base)).supervisor.commit, MAIN_B);
  } finally {
    await sup.close();
  }
});

test('a failed main commit is pruned, keeping the serving folder and the previous good one for rollback', async () => {
  const dataPath = dataDir('track-fail-prune');
  const heads = { main: MAIN_A };
  const gh = fakeMain({ heads, tarball: (sha) => (sha === MAIN_C ? releaseTarball(NEXT, { bin: 'process.exit(3);\n' }) : releaseTarball(NEXT)) });
  const { sup } = await supervise(dataPath, gh, { env: TRACK });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    heads.main = MAIN_B;
    assert.equal((await sup.check()).action, 'swapped');
    heads.main = MAIN_C;
    assert.equal((await sup.check()).action, 'failed');
    assert.deepEqual(releasesOf(dataPath), [`c${MAIN_A}`, `c${MAIN_B}`, 'state.json']);
  } finally {
    await sup.close();
  }
});

test('a deploy hook with the right token checks main at once; any other caller is refused', async () => {
  const dataPath = dataDir('track-hook');
  const gh = fakeMain({ heads: { main: MAIN_A } });
  const { sup, base } = await supervise(dataPath, gh, { env: { ...TRACK, WEAVE_DEPLOY_TOKEN: 'k'.repeat(32) } });
  try {
    const hook = (auth) => fetch(`${base}/_supervisor/check`, { method: 'POST', headers: auth ? { authorization: auth } : {} });
    assert.equal((await hook()).status, 401);
    assert.equal((await hook(`Bearer ${'x'.repeat(32)}`)).status, 401);
    assert.ok(!gh.calls.some((u) => u.includes('/commits/main')), 'a refused caller triggers nothing');
    const ok = await hook(`Bearer ${'k'.repeat(32)}`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.action, 'swapped');
    assert.equal(body.commit, MAIN_A);
  } finally {
    await sup.close();
  }
});

test('without a deploy token the hook path is not special', async () => {
  const dataPath = dataDir('track-nohook');
  const gh = fakeMain({ heads: { main: MAIN_A } });
  const { sup, base } = await supervise(dataPath, gh, { env: TRACK });
  try {
    const r = await fetch(`${base}/_supervisor/check`, { method: 'POST', headers: { authorization: 'Bearer ' } });
    assert.notEqual(r.status, 200);
    assert.ok(!gh.calls.some((u) => u.includes('/commits/main')));
  } finally {
    await sup.close();
  }
});

function walledBin(reported) {
  return `import { createServer } from 'node:http';
const s = createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ ok: true, name: 'weave' })); });
s.listen(0, '127.0.0.1', () => process.send({ weave: 'listening', port: s.address().port, version: ${JSON.stringify(reported)} }));
process.on('message', (m) => { if (m?.weave === 'migrate') process.send({ weave: 'migrated' }); });
`;
}

test('a walled worker that hides its version from anonymous health is verified by the version it reports over IPC', async () => {
  const dataPath = dataDir('walled');
  const gh = fakeGitHub({ tarball: () => releaseTarball(NEXT, { bin: walledBin(NEXT) }) });
  const { sup } = await supervise(dataPath, gh);
  try {
    const result = await sup.check();
    assert.equal(result.action, 'swapped', result.reason);
  } finally {
    await sup.close();
  }
});

test('a worker that reports a different version over IPC is refused', async () => {
  const dataPath = dataDir('walled-wrong');
  const gh = fakeGitHub({ tarball: () => releaseTarball(NEXT, { bin: walledBin('0.0.1') }) });
  const { sup, base } = await supervise(dataPath, gh);
  try {
    const result = await sup.check();
    assert.equal(result.action, 'failed');
    assert.equal((await health(base)).version, IMAGE_VERSION);
  } finally {
    await sup.close();
  }
});

test('a walled workspace swaps to a real release whose anonymous health is only {ok, name}, through the version the worker reports over IPC', async () => {
  const dataPath = dataDir('walled-real');
  const w = new Weave({ path: dataPath });
  w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  w.save();
  w.store.close();
  const gh = fakeGitHub();
  const { sup, base } = await supervise(dataPath, gh);
  try {
    const before = await health(base);
    assert.deepEqual(Object.keys(before).sort(), ['name', 'ok', 'supervisor']);
    const result = await sup.check();
    assert.equal(result.action, 'swapped', result.reason);
    const after = await health(base);
    assert.deepEqual(Object.keys(after).sort(), ['name', 'ok', 'supervisor']);
    assert.equal(after.supervisor.release, `v${NEXT}`);
    assert.equal(after.supervisor.lastSwap.ok, true);
    assert.equal(after.supervisor.lastSwap.to, `v${NEXT}`);
    assert.deepEqual(after.supervisor.failed, []);
  } finally {
    await sup.close();
  }
});
