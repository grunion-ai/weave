import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createReleaseCheck, newerVersion } from './update-check.js';
import { readTar } from './backup.js';

export const REPO_API = 'https://api.github.com/repos/grunion-ai/weave';
export const REPO_GIT = 'https://github.com/grunion-ai/weave.git';
export const REPO_CODELOAD = 'https://codeload.github.com/grunion-ai/weave';
const IMAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL = 10 * 60 * 1000;
const WATCH = 10 * 60 * 1000;
const OK_MARK = '.weave-release-ok';
const COMMIT = /^[0-9a-f]{40}$/;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
const GITHUB = { accept: 'application/vnd.github+json', 'user-agent': 'weave' };
const GIT = { accept: 'application/x-git-upload-pack-advertisement', 'user-agent': 'weave' };
const UA = { 'user-agent': 'weave' };
const REF_LINE = /([0-9a-f]{40}) ([^\0\n]+)/;

export function shaFromRefs(advertisement, ref) {
  for (const line of String(advertisement).split('\n')) {
    const m = REF_LINE.exec(line);
    if (m && m[2].trim() === ref) return m[1];
  }
  return null;
}

export function rateLimitReset(status, headers) {
  if (status !== 403 && status !== 429) return null;
  if (headers?.get?.('x-ratelimit-remaining') !== '0') return null;
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : '';
}

export const autoUpdateFromEnv = (env = process.env) => ['1', 'true', 'yes', 'on'].includes(String(env.WEAVE_AUTO_UPDATE ?? '').trim().toLowerCase());

export function trackFromEnv(env = process.env) {
  const v = String(env.WEAVE_TRACK ?? '').trim();
  if (v === 'main') return 'main';
  if (!v.startsWith('branch:')) return null;
  const branch = v.slice('branch:'.length);
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/.test(branch) || branch.includes('..')) throw new Error(`WEAVE_TRACK=${v} names no usable branch`);
  return branch;
}

class Refusal extends Error {}

const versionOf = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version; } catch { return null; } };
const forwardable = (headers, drop = []) => Object.fromEntries(Object.entries(headers).filter(([k]) => !HOP.has(k) && !drop.includes(k)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function unpackRelease(tgz, dir) {
  const root = resolve(dir);
  for (const { name, data } of readTar(gunzipSync(tgz))) {
    const rel = name.split('/').slice(1).join('/');
    if (!rel) continue;
    const out = resolve(root, rel);
    if (!out.startsWith(root + sep)) throw new Refusal(`a tarball entry escapes the release directory: ${name}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
}

function goodReleases(releasesDir, failed) {
  let names;
  try { names = readdirSync(releasesDir); } catch { return []; }
  const good = [];
  for (const name of names) {
    const commit = /^c([0-9a-f]{40})$/.exec(name)?.[1];
    const tag = /^v(\d+\.\d+\.\d+)$/.exec(name)?.[1];
    const dir = join(releasesDir, name);
    const version = versionOf(dir);
    if (!(commit || tag) || failed[commit ?? tag] || !version || (tag && version !== tag)) continue;
    let at;
    try { at = readFileSync(join(dir, OK_MARK), 'utf8'); } catch { continue; }
    good.push({ dir, version, release: name, ...(commit ? { commit } : {}), at });
  }
  return good.sort((a, b) => b.at.localeCompare(a.at));
}

export function pruneReleases(releasesDir, { serving, failed = {}, log = console } = {}) {
  let names;
  try { names = readdirSync(releasesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const rollback = goodReleases(releasesDir, failed).find((r) => r.dir !== serving)?.release;
  const removed = [];
  for (const name of names) {
    if (name === rollback || join(releasesDir, name) === serving) continue;
    try {
      rmSync(join(releasesDir, name), { recursive: true, force: true });
      removed.push(name);
    } catch (err) {
      log.warn(`weave supervise: could not remove releases/${name}: ${err.message}`);
    }
  }
  return removed;
}

const imageRelease = (imageDir, commit) => ({ dir: imageDir, version: versionOf(imageDir), release: 'image', ...(COMMIT.test(commit ?? '') ? { commit } : {}) });
const keyOf = (rel) => (rel.release.startsWith('c') ? rel.commit : rel.version);
function bootRelease({ releasesDir, imageDir, failed, tracking, commit, imageCommit }) {
  const good = goodReleases(releasesDir, failed);
  const image = imageRelease(imageDir, imageCommit);
  if (tracking) return good.find((r) => r.commit && r.commit === commit) ?? good[0] ?? image;
  return good.filter((r) => !r.commit).reduce((best, r) => (newerVersion(r.version, best.version) ? r : best), image);
}

export async function startSupervisor({
  port = 4400, host = '127.0.0.1', dataPath, imageDir = IMAGE_DIR, env = process.env, fetch = globalThis.fetch,
  interval = INTERVAL, healthTimeoutMs = 60_000, drainTimeoutMs = 30_000, log = console, onEvent = () => {},
  onWorkerDied = () => process.exit(1),
  watchMs = Number(env.WEAVE_WATCH_MS ?? WATCH), watchPollMs = 10_000,
  watchErrorRate = Number(env.WEAVE_WATCH_5XX_RATE ?? 0.25), watchMinRequests = 20, retryMs = 1000,
} = {}) {
  const releasesDir = join(dirname(resolve(dataPath)), 'releases');
  const track = trackFromEnv(env);
  const deployToken = String(env.WEAVE_DEPLOY_TOKEN ?? '').length >= 32 ? env.WEAVE_DEPLOY_TOKEN : null;
  const stateFile = join(releasesDir, 'state.json');
  let state = { failed: {}, lastSwap: null, attempting: null };
  try { state = { ...state, ...JSON.parse(readFileSync(stateFile, 'utf8')) }; } catch {}
  const save = () => { mkdirSync(releasesDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify(state, null, 1)); };
  if (state.attempting) {
    state.failed[state.attempting] = { at: new Date().toISOString(), reason: 'the supervisor stopped during the swap' };
    state.attempting = null;
    save();
  }
  if (state.watch && state.watch.ok === null) {
    state.watch = { ...state.watch, ok: false, reason: 'the supervisor stopped during the watch' };
    save();
  }
  const target = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const origin = (w) => `http://${target.includes(':') ? `[${target}]` : target}:${w.port}`;
  const release = createReleaseCheck({ version: versionOf(imageDir), fetch, interval });
  let current = null;
  let pending = null;
  let closing = false;
  let swapping = null;
  let hook = () => {};
  const emit = (e) => { onEvent(e); hook(e); };
  const prune = (serving) => pruneReleases(releasesDir, { serving, failed: state.failed, log });

  function spawnWorker(rel, { defer }) {
    const child = spawn(process.execPath, [join(rel.dir, 'bin', 'weave.js'), 'serve', '--port', '0', '--host', host, '--data', dataPath], {
      cwd: rel.dir,
      env: { ...env, ...(defer ? { WEAVE_DEFER_MIGRATIONS: '1' } : {}) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const w = { ...rel, child, port: null, inflight: 0, idle: null, settling: defer, queue: [], since: null };
    w.exited = new Promise((r) => child.once('exit', r));
    w.listening = new Promise((res, rej) => {
      child.on('message', (m) => { if (m?.weave === 'listening') { w.port = m.port; w.reported = m.version; res(); } });
      child.once('exit', (code, signal) => rej(new Refusal(`the worker exited before it listened (${signal ?? `code ${code}`})`)));
      child.once('error', rej);
    });
    w.listening.catch(() => {});
    child.once('exit', (code, signal) => {
      if (w !== current || closing) return;
      const reason = `the serving worker exited (${signal ?? `code ${code}`})`;
      log.error(`weave supervise: ${reason}`);
      if (!trip(w, reason)) onWorkerDied();
    });
    return w;
  }

  async function waitHealthy(w) {
    const until = Date.now() + healthTimeoutMs;
    await Promise.race([w.listening, sleep(healthTimeoutMs).then(() => { throw new Refusal('the worker never listened'); })]);
    let last = 'no answer';
    while (Date.now() < until) {
      if (w.child.exitCode !== null || w.child.signalCode) throw new Refusal(`the worker exited (${w.child.signalCode ?? `code ${w.child.exitCode}`})`);
      try {
        const r = await globalThis.fetch(`${origin(w)}/api/health`, { signal: AbortSignal.timeout(5000) });
        const h = await r.json();
        const version = h.version ?? w.reported;
        if (r.ok && h.ok && version === w.version) return h;
        last = `HTTP ${r.status}, version ${version}`;
      } catch (err) { last = err.message; }
      await sleep(100);
    }
    throw new Refusal(`/api/health never answered ok for ${w.version}: ${last}`);
  }

  function status() {
    return {
      release: current.release,
      dir: current.dir,
      pid: current.child.pid,
      since: current.since,
      commit: current.commit ?? null,
      track,
      lastSwap: state.lastSwap,
      watch: state.watch ?? null,
      failed: Object.keys(state.failed),
    };
  }

  function forward(req, res, w) {
    if (res.destroyed) return;
    w.inflight++;
    let done = false;
    res.once('close', () => {
      if (!done) { done = true; if (--w.inflight === 0) w.idle?.(); }
      if (!res.writableFinished) up.destroy();
    });
    const health = req.method === 'GET' && /^\/api\/health(\?|$)/.test(req.url);
    const up = request({ host: target, port: w.port, method: req.method, path: req.url, headers: forwardable(req.headers, health ? ['accept-encoding'] : []), agent: false }, (ur) => {
      tally(w, ur.statusCode);
      if (!health || ur.statusCode !== 200) {
        res.writeHead(ur.statusCode, forwardable(ur.headers));
        ur.pipe(res);
        return;
      }
      const chunks = [];
      ur.on('data', (c) => chunks.push(c));
      ur.on('end', () => {
        let body = Buffer.concat(chunks);
        try { body = Buffer.from(JSON.stringify({ ...JSON.parse(body), supervisor: status() })); } catch {}
        res.writeHead(200, { ...forwardable(ur.headers, ['content-length', 'content-encoding']), 'content-length': body.length });
        res.end(body);
      });
    });
    up.on('error', (err) => {
      tally(w, 502);
      if (res.headersSent) return res.destroy(err);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'The weave worker did not answer', code: 'unavailable' }));
    });
    req.pipe(up);
  }

  function deployHook(req, res) {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    const want = Buffer.from(`Bearer ${deployToken}`);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return send(401, { error: 'unauthorized' });
    check().then((r) => send(200, { ...r, commit: current.commit ?? null }), (err) => send(502, { error: err.message }));
  }

  function route(req, res) {
    const w = current;
    if (w.settling && (!READS.has(req.method) || req.url.startsWith('/api/auth/'))) w.queue.push([req, res]);
    else forward(req, res, w);
  }

  const server = createServer((req, res) => {
    if (deployToken && req.url === '/_supervisor/check') return deployHook(req, res);
    route(req, res);
  });

  async function github(url, tries = 3) {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(url, { headers: GITHUB, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return r.json();
      const reset = rateLimitReset(r.status, r.headers);
      if (reset === null || attempt >= tries) {
        const when = reset ? ` (rate limit resets ${reset})` : '';
        throw new Error(`GitHub answered HTTP ${r.status} for ${url}${when}`);
      }
      log.warn(`weave supervise: GitHub rate limit on ${url}${reset ? `, resets ${reset}` : ''}; retrying`);
      await sleep(retryMs * attempt);
    }
  }

  async function refSha(branch) {
    const url = `${REPO_GIT}/info/refs?service=git-upload-pack`;
    const r = await fetch(url, { headers: GIT, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`the grunion-ai/weave ref advertisement answered HTTP ${r.status}`);
    const sha = shaFromRefs(await r.text(), `refs/heads/${branch}`);
    if (!COMMIT.test(sha ?? '')) throw new Error(`grunion-ai/weave advertises no refs/heads/${branch}`);
    return sha;
  }

  async function unpackCommit(name, sha) {
    const r = await fetch(`${REPO_CODELOAD}/tar.gz/${sha}`, { headers: UA, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`the ${name} tarball answered HTTP ${r.status}`);
    const part = join(releasesDir, `${name}.part`);
    rmSync(part, { recursive: true, force: true });
    unpackRelease(Buffer.from(await r.arrayBuffer()), part);
    return part;
  }

  function settle(part, name) {
    const dir = join(releasesDir, name);
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
    return dir;
  }

  async function download(version) {
    const tag = `v${version}`;
    const cmp = await github(`${REPO_API}/compare/${tag}...main`);
    if (cmp.status !== 'ahead' && cmp.status !== 'identical') throw new Refusal(`${tag} is not on grunion-ai/weave main (compare: ${cmp.status ?? 'no status'})`);
    const sha = cmp.base_commit?.sha;
    if (!COMMIT.test(sha ?? '')) throw new Error(`GitHub named no commit for ${tag}`);
    const part = await unpackCommit(tag, sha);
    const inside = versionOf(part);
    if (inside !== version) throw new Refusal(`the ${tag} tarball's package.json says ${inside}`);
    return { dir: settle(part, tag), version, release: tag };
  }

  async function downloadCommit(sha) {
    const name = `c${sha}`;
    const part = await unpackCommit(name, sha);
    const version = versionOf(part);
    if (!version) throw new Refusal(`the ${name} tarball names no package.json version`);
    return { dir: settle(part, name), version, release: name, commit: sha };
  }

  const dead = (w) => w.child.exitCode !== null || !!w.child.signalCode;
  const markGood = (w, at) => { if (w.release !== 'image') writeFileSync(join(w.dir, OK_MARK), at); };

  function migrate(w) {
    return new Promise((r) => {
      const done = () => { clearTimeout(timer); w.child.off('message', on); r(); };
      const on = (m) => { if (m?.weave === 'migrated') done(); };
      const timer = setTimeout(done, healthTimeoutMs);
      w.child.on('message', on);
      try { w.child.send({ weave: 'migrate' }); } catch { done(); }
    }).then(() => {
      w.settling = false;
      for (const [q, r] of w.queue.splice(0)) forward(q, r, w);
    });
  }

  function dataVersions() {
    const dir = dirname(resolve(dataPath));
    const dbs = [];
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.db'))) {
      let db = null;
      try {
        db = new DatabaseSync(join(dir, name), { readOnly: true });
        dbs.push([db, db.prepare('PRAGMA data_version').get().data_version]);
      } catch {
        try { db?.close(); } catch {}
      }
    }
    return () => dbs.reduce((moved, [db, was]) => {
      let now = null;
      try { now = db.prepare('PRAGMA data_version').get().data_version; } catch {}
      try { db.close(); } catch {}
      return moved || now !== was;
    }, false);
  }

  function tally(w, code) {
    const watch = w.watch;
    if (!watch?.live) return;
    watch.hits++;
    if (code >= 500) watch.errors++;
    if (watch.hits >= watchMinRequests && watch.errors / watch.hits >= watchErrorRate) trip(w, `${watch.errors} of ${watch.hits} responses were 5xx`);
  }

  function watch(w, key, at) {
    const until = Date.now() + watchMs;
    w.watch = { key, at, live: true, migrated: false, tripped: null, hits: 0, errors: 0, misses: 0 };
    state.watch = { release: w.release, until: new Date(until).toISOString(), ok: null, migrated: false };
    save();
    let busy = false;
    const poll = setInterval(async () => {
      if (busy || !w.watch.live) return;
      busy = true;
      let ok = false;
      try {
        const r = await globalThis.fetch(`${origin(w)}/api/health`, { signal: AbortSignal.timeout(5000) });
        ok = r.ok && (await r.json()).ok === true;
      } catch {}
      busy = false;
      w.watch.misses = ok ? 0 : w.watch.misses + 1;
      if (w.watch.misses >= 3) trip(w, `/api/health failed ${w.watch.misses} checks in a row`);
    }, watchPollMs);
    const end = setTimeout(() => {
      if (!w.watch.live || w !== current) return;
      w.watch.stop();
      markGood(w, at);
      state.watch = { ...state.watch, ok: true };
      save();
      emit({ type: 'watch-passed', release: w.release });
    }, watchMs);
    w.watch.stop = () => { w.watch.live = false; clearInterval(poll); clearTimeout(end); };
  }

  function alert(w, reason) {
    const why = 'not rolled back: its deferred migration wrote to the workspace';
    state.watch = { ...state.watch, ok: false, reason, alert: why };
    save();
    log.error(`weave supervise: ALERT ${w.release} tripped its watch (${reason}); ${why}`);
    emit({ type: 'watch-alert', release: w.release, reason });
  }

  function trip(w, reason) {
    if (!w.watch?.live || w !== current || closing) return false;
    w.watch.stop();
    w.watch.tripped = reason;
    if (w.watch.migrated) { alert(w, reason); return false; }
    rollBack(w, reason).catch((err) => log.error(`weave supervise: rollback failed: ${err.message}`));
    return true;
  }

  function rollBack(w, reason) {
    return serially(async () => {
      if (w !== current || closing) return { action: 'current' };
      if (w.watch.migrated) {
        alert(w, reason);
        if (dead(w)) onWorkerDied();
        return { action: 'alert', reason };
      }
      state.failed[w.watch.key] = { at: new Date().toISOString(), reason: `watch: ${reason}` };
      state.watch = { ...state.watch, ok: false, reason };
      save();
      const back = goodReleases(releasesDir, state.failed).find((r) => r.dir !== w.dir) ?? imageRelease(imageDir, env.RAILWAY_GIT_COMMIT_SHA);
      log.error(`weave supervise: ${w.release} tripped its watch (${reason}); rolling back to ${back.release}`);
      const result = await swapTo(keyOf(back), back.release, () => back, { rollback: reason });
      if (result.action === 'swapped') emit({ type: 'rolled-back', from: w.release, to: back.release, reason });
      else if (current === w && dead(w)) onWorkerDied();
      else if (current === w && w.settling) await migrate(w);
      return result;
    });
  }

  async function swapTo(key, to, prepare, { rollback = null } = {}) {
    const at = new Date().toISOString();
    const from = current.release;
    const record = (ok, reason) => { state.lastSwap = { at, from, to, ok, ...(reason ? { reason } : {}), ...(rollback ? { rollback } : {}) }; save(); };
    let version = key;
    try {
      const rel = await prepare();
      version = rel.version;
      state.attempting = key;
      save();
      pending = spawnWorker(rel, { defer: true });
      await waitHealthy(pending);
    } catch (err) {
      if (pending) { pending.child.kill('SIGKILL'); await pending.exited; pending = null; }
      state.attempting = null;
      const verdict = err instanceof Refusal;
      if (verdict && to !== 'image') state.failed[key] = { at, reason: err.message };
      record(false, err.message);
      prune(current.dir);
      log.warn(`weave supervise: ${to} not installed: ${err.message}${verdict ? '' : ' (tried again next check)'}`);
      emit({ type: 'failed', version: key, reason: err.message });
      return { action: 'failed', version: key, reason: err.message, retry: !verdict };
    }
    const next = pending;
    const old = current;
    pending = null;
    next.since = new Date().toISOString();
    old.watch?.stop();
    current = next;
    for (const [q, r] of old.queue.splice(0)) route(q, r);
    if (!rollback && watchMs > 0) watch(next, key, at);
    emit({ type: 'switched', version });
    if (old.inflight) await new Promise((r) => { old.idle = r; setTimeout(r, drainTimeoutMs); });
    old.child.kill('SIGTERM');
    await old.exited;
    emit({ type: 'old-exited', pid: old.child.pid });
    const moved = next.watch?.live ? dataVersions() : null;
    const skip = !!next.watch?.tripped;
    if (!skip) await migrate(next);
    if (moved?.() && !skip) {
      next.watch.migrated = true;
      state.watch = { ...state.watch, migrated: true };
      log.warn(`weave supervise: ${to}'s deferred migration wrote to the workspace; it will not be rolled back automatically`);
    }
    emit({ type: 'migrated', version });
    if (!next.watch || next.watch.migrated) markGood(next, at);
    state.attempting = null;
    if (next.commit) state.commit = next.commit;
    record(true);
    prune(next.dir);
    log.log(`weave supervise: ${from} -> ${to}`);
    return { action: 'swapped', from, to, ...(next.commit ? { commit: next.commit } : {}), ...(rollback ? { rollback } : {}) };
  }

  async function tick() {
    if (track) {
      const sha = await refSha(track);
      if (sha === current.commit) return { action: 'current', commit: sha };
      if (state.failed[sha]) return { action: 'skipped', version: sha, reason: state.failed[sha].reason };
      return swapTo(sha, `c${sha}`, () => downloadCommit(sha));
    }
    await release.refresh();
    const latest = release.status()?.latestRelease;
    if (!latest || !newerVersion(latest, current.version)) return { action: 'current', latest: latest ?? null };
    if (state.failed[latest]) return { action: 'skipped', version: latest, reason: state.failed[latest].reason };
    return swapTo(latest, `v${latest}`, () => download(latest));
  }

  function serially(fn) {
    const p = (swapping ?? Promise.resolve()).catch(() => {}).then(fn).finally(() => { if (swapping === p) swapping = null; });
    swapping = p;
    return p;
  }

  function check({ onEvent: once } = {}) {
    if (closing) return Promise.resolve({ action: 'closed' });
    if (!swapping) {
      hook = once ?? (() => {});
      serially(() => tick().finally(() => { hook = () => {}; }));
    }
    return swapping;
  }

  let boot = bootRelease({ releasesDir, imageDir, failed: state.failed, tracking: !!track, commit: state.commit, imageCommit: env.RAILWAY_GIT_COMMIT_SHA });
  let first;
  for (;;) {
    first = spawnWorker(boot, { defer: false });
    try {
      await waitHealthy(first);
      break;
    } catch (err) {
      first.child.kill('SIGKILL');
      await first.exited;
      if (boot.release === 'image') throw err;
      state.failed[keyOf(boot)] = { at: new Date().toISOString(), reason: `failed at boot: ${err.message}` };
      save();
      const next = goodReleases(releasesDir, state.failed)[0] ?? imageRelease(imageDir, env.RAILWAY_GIT_COMMIT_SHA);
      log.warn(`weave supervise: ${boot.release} failed at boot (${err.message}); serving ${next.release}`);
      boot = next;
    }
  }
  first.since = new Date().toISOString();
  current = first;
  prune(current.dir);
  await new Promise((r, j) => { server.once('error', j); server.listen(port, host, r); });
  const timer = interval > 0 ? setInterval(() => check().catch((err) => log.warn(`weave supervise: check failed: ${err.message}`)), interval) : null;
  if (timer) check().catch(() => {});

  async function close() {
    closing = true;
    if (timer) clearInterval(timer);
    current.watch?.stop();
    await swapping?.catch(() => {});
    current.watch?.stop();
    server.close();
    server.closeAllConnections?.();
    for (const w of [current, pending]) {
      if (!w || w.child.exitCode !== null || w.child.signalCode) continue;
      w.child.kill('SIGTERM');
      await w.exited;
    }
  }

  return { port: server.address().port, status, check, close };
}
