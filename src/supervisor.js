import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createReleaseCheck, newerVersion } from './update-check.js';
import { readTar } from './backup.js';

export const REPO_API = 'https://api.github.com/repos/grunion-ai/weave';
const IMAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const INTERVAL = 10 * 60 * 1000;
const OK_MARK = '.weave-release-ok';
const COMMIT = /^[0-9a-f]{40}$/;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
const GITHUB = { accept: 'application/vnd.github+json', 'user-agent': 'weave' };

export const autoUpdateFromEnv = (env = process.env) => ['1', 'true', 'yes', 'on'].includes(String(env.WEAVE_AUTO_UPDATE ?? '').trim().toLowerCase());

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

export function pruneReleases(releasesDir, { serving, failed = {}, log = console } = {}) {
  let names;
  try { names = readdirSync(releasesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const servedAt = (name) => { try { return readFileSync(join(releasesDir, name, OK_MARK), 'utf8'); } catch { return null; } };
  const rollback = names.map((name) => ({ name, at: servedAt(name) }))
    .filter((r) => r.at && join(releasesDir, r.name) !== serving && !failed[r.name.slice(1)])
    .sort((a, b) => b.at.localeCompare(a.at))[0]?.name;
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
function bootRelease({ releasesDir, imageDir, failed, commit, imageCommit }) {
  const tracked = commit && join(releasesDir, `c${commit}`);
  if (tracked && !failed[commit] && existsSync(join(tracked, OK_MARK)) && versionOf(tracked)) return { dir: tracked, version: versionOf(tracked), release: `c${commit}`, commit };
  let best = imageRelease(imageDir, imageCommit);
  for (const name of existsSync(releasesDir) ? readdirSync(releasesDir) : []) {
    const version = /^v(\d+\.\d+\.\d+)$/.exec(name)?.[1];
    const dir = join(releasesDir, name);
    if (!version || failed[version] || !existsSync(join(dir, OK_MARK)) || versionOf(dir) !== version) continue;
    if (newerVersion(version, best.version)) best = { dir, version, release: name };
  }
  return best;
}

export async function startSupervisor({
  port = 4400, host = '127.0.0.1', dataPath, imageDir = IMAGE_DIR, env = process.env, fetch = globalThis.fetch,
  interval = INTERVAL, healthTimeoutMs = 60_000, drainTimeoutMs = 30_000, log = console, onEvent = () => {},
  onWorkerDied = () => process.exit(1),
} = {}) {
  const releasesDir = join(dirname(resolve(dataPath)), 'releases');
  const track = env.WEAVE_TRACK === 'main';
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
      log.error(`weave supervise: the serving worker exited (${signal ?? `code ${code}`})`);
      onWorkerDied();
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
      lastSwap: state.lastSwap,
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

  const server = createServer((req, res) => {
    if (deployToken && req.url === '/_supervisor/check') return deployHook(req, res);
    const w = current;
    if (w.settling && (!READS.has(req.method) || req.url.startsWith('/api/auth/'))) w.queue.push(() => forward(req, res, w));
    else forward(req, res, w);
  });

  async function github(url) {
    const r = await fetch(url, { headers: GITHUB, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status} for ${url}`);
    return r.json();
  }

  async function unpackCommit(name, sha) {
    const r = await fetch(`${REPO_API}/tarball/${sha}`, { headers: GITHUB, signal: AbortSignal.timeout(120_000) });
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

  async function swapTo(key, to, prepare) {
    const at = new Date().toISOString();
    const from = current.release;
    const record = (ok, reason) => { state.lastSwap = { at, from, to, ok, ...(reason ? { reason } : {}) }; save(); };
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
      if (verdict) state.failed[key] = { at, reason: err.message };
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
    current = next;
    emit({ type: 'switched', version });
    if (old.inflight) await new Promise((r) => { old.idle = r; setTimeout(r, drainTimeoutMs); });
    old.child.kill('SIGTERM');
    await old.exited;
    emit({ type: 'old-exited', pid: old.child.pid });
    await new Promise((r) => {
      const done = () => { clearTimeout(timer); next.child.off('message', on); r(); };
      const on = (m) => { if (m?.weave === 'migrated') done(); };
      const timer = setTimeout(done, healthTimeoutMs);
      next.child.on('message', on);
      try { next.child.send({ weave: 'migrate' }); } catch { done(); }
    });
    next.settling = false;
    for (const f of next.queue.splice(0)) f();
    emit({ type: 'migrated', version });
    writeFileSync(join(next.dir, OK_MARK), at);
    state.attempting = null;
    if (next.commit) state.commit = next.commit;
    record(true);
    prune(next.dir);
    log.log(`weave supervise: ${from} -> ${to}`);
    return { action: 'swapped', from, to, ...(next.commit ? { commit: next.commit } : {}) };
  }

  async function tick() {
    if (track) {
      const sha = (await github(`${REPO_API}/commits/main`)).sha;
      if (!COMMIT.test(sha ?? '')) throw new Error('GitHub named no commit for main');
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

  function check({ onEvent: once } = {}) {
    if (closing) return Promise.resolve({ action: 'closed' });
    if (!swapping) {
      hook = once ?? (() => {});
      swapping = tick().finally(() => { swapping = null; hook = () => {}; });
    }
    return swapping;
  }

  let boot = bootRelease({ releasesDir, imageDir, failed: state.failed, commit: track ? state.commit : null, imageCommit: env.RAILWAY_GIT_COMMIT_SHA });
  let first = spawnWorker(boot, { defer: false });
  try {
    await waitHealthy(first);
  } catch (err) {
    first.child.kill('SIGKILL');
    await first.exited;
    if (boot.release === 'image') throw err;
    state.failed[boot.commit ?? boot.version] = { at: new Date().toISOString(), reason: `failed at boot: ${err.message}` };
    save();
    log.warn(`weave supervise: ${boot.release} failed at boot (${err.message}); serving the image`);
    boot = imageRelease(imageDir, env.RAILWAY_GIT_COMMIT_SHA);
    first = spawnWorker(boot, { defer: false });
    await waitHealthy(first);
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
    await swapping?.catch(() => {});
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
