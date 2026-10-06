import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
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

function bootRelease({ releasesDir, imageDir, failed }) {
  let best = { dir: imageDir, version: versionOf(imageDir), release: 'image' };
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

  function spawnWorker(rel, { defer }) {
    const child = spawn(process.execPath, [join(rel.dir, 'bin', 'weave.js'), 'serve', '--port', '0', '--host', host, '--data', dataPath], {
      cwd: rel.dir,
      env: { ...env, ...(defer ? { WEAVE_DEFER_MIGRATIONS: '1' } : {}) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const w = { ...rel, child, port: null, inflight: 0, idle: null, settling: defer, queue: [], since: null };
    w.exited = new Promise((r) => child.once('exit', r));
    w.listening = new Promise((res, rej) => {
      child.on('message', (m) => { if (m?.weave === 'listening') { w.port = m.port; res(); } });
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
        if (r.ok && h.ok && h.version === w.version) return h;
        last = `HTTP ${r.status}, version ${h.version}`;
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

  const server = createServer((req, res) => {
    const w = current;
    if (w.settling && (!READS.has(req.method) || req.url.startsWith('/api/auth/'))) w.queue.push(() => forward(req, res, w));
    else forward(req, res, w);
  });

  async function github(url) {
    const r = await fetch(url, { headers: GITHUB, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status} for ${url}`);
    return r.json();
  }

  async function download(version) {
    const tag = `v${version}`;
    const cmp = await github(`${REPO_API}/compare/${tag}...main`);
    if (cmp.status !== 'ahead' && cmp.status !== 'identical') throw new Refusal(`${tag} is not on grunion-ai/weave main (compare: ${cmp.status ?? 'no status'})`);
    const sha = cmp.base_commit?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`GitHub named no commit for ${tag}`);
    const r = await fetch(`${REPO_API}/tarball/${sha}`, { headers: GITHUB, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`the ${tag} tarball answered HTTP ${r.status}`);
    const part = join(releasesDir, `${tag}.part`);
    rmSync(part, { recursive: true, force: true });
    unpackRelease(Buffer.from(await r.arrayBuffer()), part);
    const inside = versionOf(part);
    if (inside !== version) throw new Refusal(`the ${tag} tarball's package.json says ${inside}`);
    const dir = join(releasesDir, tag);
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
    return dir;
  }

  async function swapTo(version) {
    const at = new Date().toISOString();
    const to = `v${version}`;
    const from = current.release;
    const record = (ok, reason) => { state.lastSwap = { at, from, to, ok, ...(reason ? { reason } : {}) }; save(); };
    try {
      const dir = await download(version);
      state.attempting = version;
      save();
      pending = spawnWorker({ dir, version, release: to }, { defer: true });
      await waitHealthy(pending);
    } catch (err) {
      if (pending) { pending.child.kill('SIGKILL'); await pending.exited; pending = null; }
      state.attempting = null;
      const verdict = err instanceof Refusal;
      if (verdict) state.failed[version] = { at, reason: err.message };
      record(false, err.message);
      log.warn(`weave supervise: ${to} not installed: ${err.message}${verdict ? '' : ' (tried again next check)'}`);
      emit({ type: 'failed', version, reason: err.message });
      return { action: 'failed', version, reason: err.message, retry: !verdict };
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
    record(true);
    for (const name of readdirSync(releasesDir)) {
      const dir = join(releasesDir, name);
      if (/^v\d/.test(name) && dir !== next.dir && dir !== old.dir) rmSync(dir, { recursive: true, force: true });
    }
    log.log(`weave supervise: ${from} -> ${to}`);
    return { action: 'swapped', from, to };
  }

  async function tick() {
    await release.refresh();
    const latest = release.status()?.latestRelease;
    if (!latest || !newerVersion(latest, current.version)) return { action: 'current', latest: latest ?? null };
    if (state.failed[latest]) return { action: 'skipped', version: latest, reason: state.failed[latest].reason };
    return swapTo(latest);
  }

  function check({ onEvent: once } = {}) {
    if (closing) return Promise.resolve({ action: 'closed' });
    if (!swapping) {
      hook = once ?? (() => {});
      swapping = tick().finally(() => { swapping = null; hook = () => {}; });
    }
    return swapping;
  }

  let boot = bootRelease({ releasesDir, imageDir, failed: state.failed });
  let first = spawnWorker(boot, { defer: false });
  try {
    await waitHealthy(first);
  } catch (err) {
    first.child.kill('SIGKILL');
    await first.exited;
    if (boot.release === 'image') throw err;
    state.failed[boot.version] = { at: new Date().toISOString(), reason: `failed at boot: ${err.message}` };
    save();
    log.warn(`weave supervise: ${boot.release} failed at boot (${err.message}); serving the image`);
    boot = { dir: imageDir, version: versionOf(imageDir), release: 'image' };
    first = spawnWorker(boot, { defer: false });
    await waitHealthy(first);
  }
  first.since = new Date().toISOString();
  current = first;
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
