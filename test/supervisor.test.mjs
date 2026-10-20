import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, statSync, copyFileSync, writeFileSync, chmodSync, openSync, writeSync, closeSync, createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync, createGzip } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './lib/source.mjs';
import { bootAndStop } from './lib/serve-fixture.mjs';
import { packTar } from '../src/backup.js';
import { Weave, deferMigrations, runDeferredMigrations } from '../src/engine.js';
import { startSupervisor, autoUpdateFromEnv, trackFromEnv, unpackRelease, pruneReleases, shaFromRefs, rateLimitReset, REPO_API, REPO_GIT, REPO_CODELOAD } from '../src/supervisor.js';
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

const REFS_URL = `${REPO_GIT}/info/refs?service=git-upload-pack`;

function advertisement(heads) {
  const pkt = (s) => (s.length + 4).toString(16).padStart(4, '0') + s;
  const out = [pkt('# service=git-upload-pack\n'), '0000'];
  let first = true;
  for (const [branch, sha] of Object.entries(heads)) {
    out.push(pkt(`${sha} refs/heads/${branch}${first ? '\0multi_ack thin-pack side-band ofs-delta\n' : '\n'}`));
    first = false;
  }
  return out.join('') + '0000';
}

const limited = (reset) => new Response('rate limited', { status: 403, headers: { 'x-ratelimit-remaining': '0', ...(reset ? { 'x-ratelimit-reset': String(reset) } : {}) } });

function fakeGitHub({ version = NEXT, compare = 'ahead', tarball = () => releaseTarball(version) } = {}) {
  const calls = [];
  let tgz = null;
  const fetch = async (url) => {
    url = String(url);
    calls.push(url);
    if (url === RELEASES_URL) return Response.json({ tag_name: `v${version}` });
    if (url === `${REPO_API}/compare/v${version}...main`) return Response.json({ status: compare, base_commit: { sha: SHA } });
    if (url === `${REPO_CODELOAD}/tar.gz/${SHA}`) return new Response((tgz ??= tarball()));
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
    interval: 0, healthTimeoutMs: 60_000, watchMs: 0, log: { log() {}, warn() {}, error() {} },
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

const LOOPS = 6;
function swapFaults(sequences, order) {
  const rank = new Map(order.map((v, i) => [v, i]));
  const faults = [];
  sequences.forEach((seq, loop) => {
    let reached = -1;
    for (const [at, version] of seq.entries()) {
      const r = rank.get(version);
      if (r === undefined) return void faults.push({ loop, at, version, fault: 'unknown version' });
      if (r < reached) return void faults.push({ loop, at, version, fault: 'routed back' });
      reached = r;
    }
  });
  return faults;
}

test('the swap observer separates out-of-order completion from routing that moved backward', () => {
  const order = [IMAGE_VERSION, NEXT];
  assert.deepEqual(swapFaults([[IMAGE_VERSION], [NEXT], [IMAGE_VERSION], [NEXT]], order), [], 'four loops each settled on one side of the swap: the interleaving of CI run 38111777298 is completion order, not routing order');
  assert.deepEqual(swapFaults([[IMAGE_VERSION, NEXT], [NEXT], [IMAGE_VERSION]], order), [], 'a loop crossing the swap once is the expected shape');
  assert.deepEqual(swapFaults([[IMAGE_VERSION, NEXT, IMAGE_VERSION]], order), [{ loop: 0, at: 2, version: IMAGE_VERSION, fault: 'routed back' }], 'one loop sent back to the old worker is a fault');
  assert.deepEqual(swapFaults([[NEXT], [IMAGE_VERSION, '0.0.0']], order), [{ loop: 1, at: 1, version: '0.0.0', fault: 'unknown version' }], 'a version from neither release is a fault');
  assert.deepEqual(swapFaults([[]], order), [], 'a loop that answered nothing reports nothing');
});

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
    const seen = Array.from({ length: LOOPS }, () => []);
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
          else if (body.version && seen[i].at(-1) !== body.version) seen[i].push(body.version);
        } catch (err) {
          failures.push(err.message);
        }
      }
    };
    const loops = Array.from({ length: LOOPS }, (_, i) => loop(i));
    await new Promise((r) => setTimeout(r, 300));
    const result = await sup.check();
    await new Promise((r) => setTimeout(r, 300));
    stop = true;
    await Promise.all(loops);

    assert.equal(result.action, 'swapped', JSON.stringify(result));
    assert.deepEqual(failures, [], `no request failed across the swap (${requests} sent)`);
    const observed = seen.flat();
    assert.deepEqual(swapFaults(seen, [IMAGE_VERSION, NEXT]), [], `no loop was routed back to the old worker across the swap (${JSON.stringify(seen)})`);
    assert.ok(observed.includes(IMAGE_VERSION) && observed.includes(NEXT), `the loops saw the old version and the new one (${JSON.stringify(seen)})`);
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
    const tarballs = () => gh.calls.filter((u) => u.includes('/tar.gz/')).length;
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
      assert.ok(!gh.calls.some((u) => u.includes('/tar.gz/')), 'no tarball was fetched');
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

test('unpackRelease strips the top directory and refuses an entry that climbs out', async () => {
  const dir = mkdtempSync(join(scratch, 'unpack-'));
  const tar = join(dir, 'a.tar');
  packTar(tar, [{ name: 'top/package.json', data: Buffer.from('{"version":"1.2.3"}') }, { name: 'top/src/x.js', data: Buffer.from('x') }, { name: 'top/empty.txt', data: Buffer.alloc(0) }]);
  await unpackRelease(gzipSync(readFileSync(tar)), join(dir, 'out'));
  assert.equal(readFileSync(join(dir, 'out', 'src', 'x.js'), 'utf8'), 'x');
  assert.equal(readFileSync(join(dir, 'out', 'package.json'), 'utf8'), '{"version":"1.2.3"}');
  assert.equal(readFileSync(join(dir, 'out', 'empty.txt'), 'utf8'), '');
  packTar(tar, [{ name: 'top/ok.js', data: Buffer.from('ok') }, { name: 'top/../../evil.js', data: Buffer.from('x') }]);
  await assert.rejects(unpackRelease(gzipSync(readFileSync(tar)), join(dir, 'out2')), /escapes/);
  assert.ok(!existsSync(join(dir, 'evil.js')));
});

test('unpackRelease reads a fetch body stream and refuses a truncated or corrupt archive', async () => {
  const dir = mkdtempSync(join(scratch, 'unpack-body-'));
  const tar = join(dir, 'a.tar');
  const big = randomBytes(70_000);
  packTar(tar, [{ name: 'top/a.bin', data: big }, { name: 'top/b.txt', data: Buffer.from('b') }]);
  const tgz = gzipSync(readFileSync(tar));
  await unpackRelease(new Response(tgz).body, join(dir, 'out'));
  assert.ok(readFileSync(join(dir, 'out', 'a.bin')).equals(big));
  assert.equal(readFileSync(join(dir, 'out', 'b.txt'), 'utf8'), 'b');
  const cut = readFileSync(tar).subarray(0, 512 + 40_000);
  await assert.rejects(unpackRelease(gzipSync(cut), join(dir, 'cut')), /truncated/);
  const bad = Buffer.from(readFileSync(tar));
  bad[0] ^= 0xff;
  await assert.rejects(unpackRelease(gzipSync(bad), join(dir, 'bad')), /checksum/);
});

test('unpackRelease streams a large archive without holding it in memory (Issue #954)', async (t) => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc');
  const dir = mkdtempSync(join(scratch, 'unpack-large-'));
  const blob = join(dir, 'blob.bin');
  const MB = 1024 * 1024;
  const fd = openSync(blob, 'w');
  const want = createHash('sha256');
  for (let i = 0; i < 36; i++) {
    const chunk = Buffer.concat([randomBytes(MB / 2), Buffer.alloc(MB / 2, i)]);
    writeSync(fd, chunk);
    want.update(chunk);
  }
  closeSync(fd);
  const tar = join(dir, 'r.tar');
  packTar(tar, [{ name: 'top/package.json', data: Buffer.from('{"version":"1.2.3"}') }, { name: 'top/data/blob.bin', path: blob }]);
  const tgz = join(dir, 'r.tar.gz');
  await pipeline(createReadStream(tar), createGzip(), createWriteStream(tgz));
  const archive = statSync(tar).size;
  assert.ok(archive >= 30 * MB, `fixture tar is ${archive} bytes`);
  rmSync(blob);
  gc();
  const base = process.memoryUsage();
  let peakBuffers = 0, peakLive = 0, peakRss = 0, samples = 0;
  const sample = () => {
    const m = process.memoryUsage();
    peakBuffers = Math.max(peakBuffers, m.arrayBuffers - base.arrayBuffers);
    peakRss = Math.max(peakRss, m.rss - base.rss);
    gc();
    peakLive = Math.max(peakLive, process.memoryUsage().arrayBuffers - base.arrayBuffers);
    samples++;
  };
  const timer = setInterval(sample, 5);
  try {
    await unpackRelease(createReadStream(tgz), join(dir, 'out'));
  } finally {
    clearInterval(timer);
  }
  sample();
  const after = process.memoryUsage();
  const mb = (n) => (n / MB).toFixed(1);
  t.diagnostic(`issue-954 memory: tar ${mb(archive)} MB, gz ${mb(statSync(tgz).size)} MB, ${samples} samples, peak live buffers +${mb(peakLive)} MB, peak arrayBuffers before gc +${mb(peakBuffers)} MB, peak rss +${mb(peakRss)} MB, after rss +${mb(after.rss - base.rss)} MB`);
  assert.ok(samples >= 3, `only ${samples} memory samples ran during the unpack`);
  assert.ok(peakLive < archive / 16, `live buffers grew ${peakLive} bytes for a ${archive}-byte archive`);
  assert.ok(peakBuffers < archive / 2, `arrayBuffers grew ${peakBuffers} bytes for a ${archive}-byte archive`);
  assert.ok(peakRss < archive / 2, `peak rss grew ${peakRss} bytes for a ${archive}-byte archive`);
  const got = createHash('sha256');
  for await (const chunk of createReadStream(join(dir, 'out', 'data', 'blob.bin'))) got.update(chunk);
  assert.equal(got.digest('hex'), want.digest('hex'));
  assert.equal(readFileSync(join(dir, 'out', 'package.json'), 'utf8'), '{"version":"1.2.3"}');
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
    if (url === REFS_URL) return new Response(advertisement(heads));
    const sha = /\/tar\.gz\/([0-9a-f]{40})$/.exec(url)?.[1];
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

test('WEAVE_TRACK names main, a branch through branch:<name>, or nothing; a malformed branch is refused', () => {
  assert.equal(trackFromEnv({ WEAVE_TRACK: 'main' }), 'main');
  assert.equal(trackFromEnv({ WEAVE_TRACK: 'branch:production' }), 'production');
  assert.equal(trackFromEnv({ WEAVE_TRACK: 'branch:release/v1' }), 'release/v1');
  for (const v of [undefined, '', 'release', 'production']) assert.equal(trackFromEnv(v === undefined ? {} : { WEAVE_TRACK: v }), null, `WEAVE_TRACK=${v}`);
  for (const v of ['branch:', 'branch:a b', 'branch:../main', 'branch:-x']) assert.throws(() => trackFromEnv({ WEAVE_TRACK: v }), /WEAVE_TRACK/, v);
});

test('tracking a promotion branch follows that branch, never main, and the deploy hook checks it', async () => {
  const dataPath = dataDir('track-branch');
  const heads = { main: MAIN_A, production: MAIN_B };
  const gh = fakeMain({ heads });
  const { sup, base } = await supervise(dataPath, gh, { env: { ...ENV, WEAVE_TRACK: 'branch:production', WEAVE_DEPLOY_TOKEN: 'k'.repeat(32) } });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    const h = await health(base);
    assert.equal(h.supervisor.commit, MAIN_B);
    assert.equal(h.supervisor.release, `c${MAIN_B}`);
    assert.equal(h.supervisor.track, 'production');
    assert.ok(gh.calls.includes(REFS_URL));
    assert.ok(!gh.calls.some((u) => u.startsWith(REPO_API)), 'the rate-limited REST API is never asked');
    heads.production = MAIN_C;
    const hook = await fetch(`${base}/_supervisor/check`, { method: 'POST', headers: { authorization: `Bearer ${'k'.repeat(32)}` } });
    const body = await hook.json();
    assert.equal(body.action, 'swapped');
    assert.equal(body.commit, MAIN_C);
  } finally {
    await sup.close();
  }
});

function fakeBin(version, { afterMigrate = '', migrateWrites = false } = {}) {
  return `import { createServer } from 'node:http';
${migrateWrites ? "import { DatabaseSync } from 'node:sqlite';" : ''}
const data = process.argv[process.argv.indexOf('--data') + 1];
let sick = false;
let broken = false;
const s = createServer((q, r) => {
  r.setHeader('content-type', 'application/json');
  if (q.url.startsWith('/api/health')) { r.statusCode = sick ? 503 : 200; return r.end(JSON.stringify({ ok: !sick, name: 'weave', version: ${JSON.stringify(version)} })); }
  r.statusCode = broken ? 500 : 200;
  r.end('{}');
});
s.listen(0, '127.0.0.1', () => process.send({ weave: 'listening', port: s.address().port, version: ${JSON.stringify(version)} }));
process.on('message', (m) => {
  if (m?.weave !== 'migrate') return;
  ${migrateWrites ? "const db = new DatabaseSync(data); db.exec('PRAGMA busy_timeout = 5000'); db.exec('CREATE TABLE IF NOT EXISTS fake_migration (x)'); db.close();" : ''}
  process.send({ weave: 'migrated' });
  ${afterMigrate}
});
`;
}

const waitFor = async (what, ms = 30_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await what();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting');
};
const WATCH = { watchMs: 1500, watchPollMs: 50 };
const okMark = (dataPath, name) => existsSync(join(dataPath, '..', 'releases', name, '.weave-release-ok'));

test('a release that passes its watch is marked good only then, and the watch shows in health', async () => {
  const dataPath = dataDir('watch-pass');
  const { sup, base, events } = await supervise(dataPath, fakeGitHub(), WATCH);
  try {
    assert.equal((await sup.check()).action, 'swapped');
    const during = await health(base);
    assert.equal(during.supervisor.watch.ok, null, 'watching');
    assert.ok(Date.parse(during.supervisor.watch.until) > Date.now());
    assert.equal(during.supervisor.watch.migrated, false, 'a real release on a current workspace writes nothing at migrate');
    assert.ok(!okMark(dataPath, `v${NEXT}`), 'not good yet');
    await waitFor(() => events.some((e) => e.type === 'watch-passed'));
    assert.equal((await health(base)).supervisor.watch.ok, true);
    assert.ok(okMark(dataPath, `v${NEXT}`), 'good once the watch passed');
  } finally {
    await sup.close();
  }
});

test('a serving worker that exits inside its watch rolls back to the image when no good release is kept', async () => {
  const dataPath = dataDir('watch-exit');
  const heads = { main: MAIN_A };
  const gh = fakeMain({ heads, tarball: () => releaseTarball(NEXT, { bin: fakeBin(NEXT, { afterMigrate: 'setTimeout(() => process.exit(7), 100);' }) }) });
  const { sup, base, events } = await supervise(dataPath, gh, { env: TRACK, ...WATCH });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    await waitFor(() => events.some((e) => e.type === 'rolled-back'));
    const h = await health(base);
    assert.equal(h.version, IMAGE_VERSION);
    assert.equal(h.supervisor.release, 'image');
    assert.equal(h.supervisor.lastSwap.ok, true);
    assert.equal(h.supervisor.lastSwap.from, `c${MAIN_A}`);
    assert.equal(h.supervisor.lastSwap.to, 'image');
    assert.match(h.supervisor.lastSwap.rollback, /exited/);
    assert.equal(h.supervisor.watch.ok, false);
    assert.deepEqual(h.supervisor.failed, [MAIN_A]);
    assert.equal((await sup.check()).action, 'skipped', 'the rolled-back commit is not tried again until the branch moves');
  } finally {
    await sup.close();
  }
});

test('three failed health checks inside the watch roll back to the kept good release', async () => {
  const dataPath = dataDir('watch-health');
  const heads = { main: MAIN_A };
  const gh = fakeMain({ heads, tarball: (sha) => releaseTarball(NEXT, { bin: fakeBin(NEXT, sha === MAIN_B ? { afterMigrate: 'sick = true;' } : {}) }) });
  const { sup, base, events } = await supervise(dataPath, gh, { env: TRACK, ...WATCH });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    await waitFor(() => events.some((e) => e.type === 'watch-passed'));
    heads.main = MAIN_B;
    assert.equal((await sup.check()).action, 'swapped');
    await waitFor(() => events.some((e) => e.type === 'rolled-back'));
    const h = await health(base);
    assert.equal(h.supervisor.commit, MAIN_A);
    assert.equal(h.supervisor.release, `c${MAIN_A}`);
    assert.equal(h.supervisor.lastSwap.from, `c${MAIN_B}`);
    assert.equal(h.supervisor.lastSwap.to, `c${MAIN_A}`);
    assert.match(h.supervisor.lastSwap.rollback, /health/);
    assert.deepEqual(h.supervisor.failed, [MAIN_B]);
    assert.ok(!okMark(dataPath, `c${MAIN_B}`), 'the bad release was never marked good');
  } finally {
    await sup.close();
  }
});

test('a 5xx rate past the threshold inside the watch rolls back', async () => {
  const dataPath = dataDir('watch-5xx');
  const gh = fakeMain({ heads: { main: MAIN_A }, tarball: () => releaseTarball(NEXT, { bin: fakeBin(NEXT, { afterMigrate: 'broken = true;' }) }) });
  const { sup, base, events } = await supervise(dataPath, gh, { env: TRACK, ...WATCH, watchMs: 20_000 });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    for (let i = 0; i < 25 && !events.some((e) => e.type === 'rolled-back'); i++) await fetch(`${base}/api/anything`).then((r) => r.arrayBuffer());
    await waitFor(() => events.some((e) => e.type === 'rolled-back'));
    const h = await health(base);
    assert.equal(h.supervisor.release, 'image');
    assert.match(h.supervisor.lastSwap.rollback, /5xx/);
  } finally {
    await sup.close();
  }
});

test('a release whose deferred migration wrote to the workspace is never rolled back: it is marked good and a trip only alerts', async () => {
  const dataPath = dataDir('watch-migrated');
  const gh = fakeMain({ heads: { main: MAIN_A }, tarball: () => releaseTarball(NEXT, { bin: fakeBin(NEXT, { migrateWrites: true, afterMigrate: 'sick = true;' }) }) });
  const { sup, events } = await supervise(dataPath, gh, { env: TRACK, ...WATCH });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    await waitFor(() => events.some((e) => e.type === 'watch-alert'));
    const s = sup.status();
    assert.equal(s.release, `c${MAIN_A}`, 'still serving the migrated release');
    assert.equal(s.watch.migrated, true);
    assert.equal(s.watch.ok, false);
    assert.match(s.watch.alert, /migration/);
    assert.deepEqual(s.failed, []);
    assert.ok(okMark(dataPath, `c${MAIN_A}`), 'marked good the moment its migration wrote');
    assert.ok(!events.some((e) => e.type === 'rolled-back'));
  } finally {
    await sup.close();
  }
});

function plantRunnable(releasesDir, name, version, served, bin) {
  const dir = plantRelease(releasesDir, name, { version, served });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'weave', version, type: 'module' }));
  writeFileSync(join(dir, 'bin', 'weave.js'), bin);
  return dir;
}

test('a boot that fails falls back to the newest good release folder before the image, for commit and version folders', async () => {
  const crash = 'process.exit(3);\n';
  const tracked = dataDir('boot-fallback-commit');
  const dir = join(tracked, '..', 'releases');
  plantRunnable(dir, `c${MAIN_A}`, NEXT, '2026-10-01T00:00:00.000Z', fakeBin(NEXT));
  plantRunnable(dir, `c${MAIN_B}`, NEXT, '2026-10-02T00:00:00.000Z', crash);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ failed: {}, commit: MAIN_B }));
  const a = await supervise(tracked, fakeMain({ heads: { main: MAIN_B } }), { env: TRACK });
  try {
    const s = a.sup.status();
    assert.equal(s.release, `c${MAIN_A}`);
    assert.deepEqual(s.failed, [MAIN_B]);
  } finally {
    await a.sup.close();
  }
  const versioned = dataDir('boot-fallback-version');
  const vdir = join(versioned, '..', 'releases');
  plantRunnable(vdir, 'v9.9.8', '9.9.8', '2026-10-01T00:00:00.000Z', fakeBin('9.9.8'));
  plantRunnable(vdir, 'v9.9.9', '9.9.9', '2026-10-02T00:00:00.000Z', crash);
  const b = await supervise(versioned, fakeGitHub());
  try {
    const s = b.sup.status();
    assert.equal(s.release, 'v9.9.8');
    assert.deepEqual(s.failed, ['9.9.9']);
  } finally {
    await b.sup.close();
  }
});

test('shaFromRefs reads a branch head out of a git ref advertisement, capabilities and all', () => {
  const refs = advertisement({ main: MAIN_A, production: MAIN_B });
  assert.equal(shaFromRefs(refs, 'refs/heads/main'), MAIN_A);
  assert.equal(shaFromRefs(refs, 'refs/heads/production'), MAIN_B);
  assert.equal(shaFromRefs(refs, 'refs/heads/absent'), null);
  assert.equal(shaFromRefs('', 'refs/heads/main'), null);
});

test('rateLimitReset names the reset only for a spent quota', () => {
  const at = 1792150992;
  assert.equal(rateLimitReset(403, limited(at).headers), new Date(at * 1000).toISOString());
  assert.equal(rateLimitReset(429, limited(at).headers), new Date(at * 1000).toISOString());
  assert.equal(rateLimitReset(403, limited(null).headers), '');
  assert.equal(rateLimitReset(403, new Response('nope', { status: 403 }).headers), null, 'a plain 403 is not a rate limit');
  assert.equal(rateLimitReset(404, limited(at).headers), null);
});

test('tracking main reads the head through the git protocol, so a spent REST quota still swaps dev', async () => {
  const dataPath = dataDir('track-ratelimited');
  const heads = { main: MAIN_A };
  const inner = fakeMain({ heads });
  const calls = inner.calls;
  const fetch = (url) => (String(url).startsWith(REPO_API) ? Promise.resolve(limited(1792150992)) : inner.fetch(url));
  const { sup, base } = await supervise(dataPath, { fetch, calls }, { env: TRACK });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    assert.equal((await health(base)).supervisor.commit, MAIN_A);
    assert.ok(calls.includes(REFS_URL), 'the ref advertisement is what names the head');
    assert.ok(!calls.some((u) => u.startsWith(REPO_API)), 'api.github.com is never asked for the commit or the tarball');
  } finally {
    await sup.close();
  }
});

test('a rate-limited REST call is retried and its error names the reset', async () => {
  const dataPath = dataDir('reset-named');
  const at = 1792150992;
  const gh = fakeGitHub();
  const calls = gh.calls;
  const fetch = (url) => (String(url).includes('/compare/') ? (calls.push(String(url)), Promise.resolve(limited(at))) : gh.fetch(url));
  const { sup } = await supervise(dataPath, { fetch, calls }, { retryMs: 1 });
  try {
    const r = await sup.check();
    assert.equal(r.action, 'failed');
    assert.equal(r.retry, true);
    assert.match(r.reason, /HTTP 403/);
    assert.match(r.reason, new RegExp(`rate limit resets ${new Date(at * 1000).toISOString()}`));
    assert.equal(calls.filter((u) => u.includes('/compare/')).length, 3, 'the rate-limited call is tried three times');
  } finally {
    await sup.close();
  }
});
