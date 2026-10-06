import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, lstatSync, chmodSync, unlinkSync, readFileSync, statfsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir, cpus, loadavg, totalmem, freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const SELF = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SOURCE = createHash('sha256').update(readFileSync(SELF)).digest('hex').slice(0, 12);
export const managerDirectory = (env = process.env) => env.WEAVE_TEST_MANAGER_DIR || join('/tmp', `weave-test-manager-${process.getuid?.() ?? 'local'}-${SOURCE}`);
export const NOT_ADMITTED = 75;
export const DEFAULT_JOB_TIMEOUT_MS = 60 * 60_000;
export const jobTimeout = ms => Math.max(100, Math.min(Number(ms) || DEFAULT_JOB_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS));
export const queueWait = (env = {}) => Number(env.WEAVE_TEST_QUEUE_WAIT_MS) || 30 * 60_000;
export const ADMISSION_ENV = ['WEAVE_TEST_MIN_FREE_GB', 'WEAVE_TEST_MIN_MEMORY_PERCENT', 'WEAVE_TEST_MAX_LOAD', 'WEAVE_TEST_QUEUE_WAIT_MS'];
export const admissionEnv = (env = process.env) => Object.fromEntries(ADMISSION_ENV.filter(k => env[k] !== undefined && env[k] !== '').map(k => [k, env[k]]));
const send = (socket, data) => { if (!socket.destroyed) socket.write(JSON.stringify(data) + '\n'); };
function lines(socket, receive) {
  let pending = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    pending += chunk;
    if (pending.length > 8 * 1024 * 1024) return socket.destroy(new Error('oversized manager message'));
    for (let i; (i = pending.indexOf('\n')) >= 0;) {
      const line = pending.slice(0, i); pending = pending.slice(i + 1);
      try { receive(JSON.parse(line)); } catch (error) { send(socket, { error: error.message, code: 1 }); socket.end(); }
    }
  });
}
function secureDirectory(directory) {
  if (Buffer.byteLength(join(directory, 'manager.sock')) > 103) throw new Error('Test manager socket path too long; use a shorter WEAVE_TEST_MANAGER_DIR');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid())) throw new Error('unsafe test manager directory');
  chmodSync(directory, 0o700);
}
function connect(directory) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(join(directory, 'manager.sock'));
    socket.once('error', reject); socket.once('connect', () => { socket.removeListener('error', reject); resolve(socket); });
  });
}
export async function request(message, { directory = managerDirectory(), start = false, onMessage = () => {}, lease = false } = {}) {
  secureDirectory(directory);
  let socket;
  try { socket = await connect(directory); }
  catch (error) {
    if (!start) throw error;
    const child = spawn(process.execPath, [SELF, '--serve', directory], { detached: true, stdio: 'ignore', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
    child.unref();
    for (let i = 0; i < 100; i++) {
      try { socket = await connect(directory); break; } catch { await sleep(50); }
    }
    if (!socket) throw new Error('test manager did not start');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const terminate = () => socket.destroy();
    const done = () => { process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate); };
    process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
    socket.on('error', reject);
    socket.on('close', () => { done(); if (!settled) reject(new Error('test manager disconnected; job cancelled')); });
    lines(socket, result => {
      onMessage(result);
      if ('code' in result || result.type === 'status' || result.endpoint) {
        settled = true; done();
        if (lease && result.endpoint) resolve({ ...result, release: () => socket.end() });
        else { socket.end(); resolve(result); }
      }
    });
    send(socket, message);
  });
}
export function fingerprint(root, files = []) {
  const hash = createHash('sha256');
  let tracked;
  try { tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0').filter(Boolean); }
  catch { tracked = []; }
  for (const path of [...new Set([...tracked.map(f => resolve(root, f)), ...files.map(f => resolve(root, f))])].sort()) {
    hash.update(path + '\0');
    try { hash.update(readFileSync(path)); } catch (e) { hash.update(e.code || 'unreadable'); }
  }
  try { hash.update(readFileSync(createRequire(join(root, 'package.json')).resolve('playwright/package.json'))); } catch {}
  return hash.digest('hex');
}
export function resourceReason({ freeGB, memoryPercent, load, cpus: cores }, env = {}) {
  if (freeGB < Number(env.WEAVE_TEST_MIN_FREE_GB ?? 10)) return `disk: ${freeGB.toFixed(1)} GB free (minimum ${env.WEAVE_TEST_MIN_FREE_GB ?? 10})`;
  if (memoryPercent < Number(env.WEAVE_TEST_MIN_MEMORY_PERCENT ?? 10)) return `memory: ${memoryPercent.toFixed(1)}% available`;
  if (load > Number(env.WEAVE_TEST_MAX_LOAD ?? cores * 2)) return `load: ${load.toFixed(1)} (limit ${env.WEAVE_TEST_MAX_LOAD ?? cores * 2})`;
  return null;
}
function pressure(root, env) {
  const disks = [statfsSync(tmpdir()), statfsSync(root)].map(s => Number(s.bavail) * Number(s.bsize) / 1024 ** 3);
  let memoryPercent = 100 * freemem() / totalmem();
  if (process.platform === 'darwin') {
    try { memoryPercent = Number(execFileSync('memory_pressure', ['-Q'], { timeout: 1500, encoding: 'utf8' }).match(/free percentage:\s*(\d+)%/)?.[1] ?? memoryPercent); } catch {}
  } else if (process.platform === 'linux') {
    const available = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s*(\d+)/);
    if (available) memoryPercent = Number(available[1]) * 1024 / totalmem() * 100;
  }
  return resourceReason({ freeGB: Math.min(...disks), memoryPercent, load: loadavg()[0], cpus: cpus().length }, env);
}
export async function serve(directory) {
  secureDirectory(directory);
  const socketPath = join(directory, 'manager.sock');
  let stale; try { stale = lstatSync(socketPath); } catch {}
  try { const live = await connect(directory); live.end(); return; }
  catch (error) { if (error.code === 'ECONNREFUSED') { try { const now = lstatSync(socketPath); if (stale && now.ino === stale.ino && now.birthtimeMs === stale.birthtimeMs) unlinkSync(socketPath); } catch {} } else if (error.code !== 'ENOENT') throw error; }
  const waiting = []; let active = null; let browser = null; let browserKey = ''; let browserJobs = 0; let browserBorn = 0; let launching; let lastUsed = Date.now(); let stopping = false; let admitting = false;
  const summary = job => job && ({ id: job.id, root: job.root, files: job.files, type: job.type, fingerprint: job.fingerprint, queuedAt: job.queuedAt, startedAt: job.startedAt, reason: job.reason });
  async function recycle() { const old = browser; browser = null; browserKey = ''; browserJobs = 0; if (old) await old.close().catch(() => {}); }
  async function endpoint(job) {
    if (launching) await launching;
    launching = openBrowser(job);
    try { return await launching; } finally { launching = null; }
  }
  async function openBrowser(job) {
    const require = createRequire(join(job.root, 'package.json'));
    let modulePath;
    try { modulePath = require.resolve('playwright'); } catch { return null; }
    const kind = job.env?.WEAVE_BROWSER || 'chromium';
    const key = `${modulePath}:${kind}`;
    if (browser && key !== browserKey) await recycle();
    if (!browser) {
      const loaded = await import(pathToFileURL(modulePath).href);
      const pw = loaded.default || loaded;
      if (!pw[kind]) throw new Error(`unsupported browser: ${kind}`);
      browser = await pw[kind].launchServer({ host: '127.0.0.1' });
      browserKey = key; browserBorn = Date.now();
      browser.on('close', () => { browser = null; browserKey = ''; });
    }
    job.usedBrowser = true;
    return browser.wsEndpoint();
  }
  function kill(job) {
    if (!job.child) return;
    try { process.kill(-job.child.pid, 'SIGTERM'); } catch {}
  }
  async function finish(job, code, error) {
    if (job.finishing) return;
    job.finishing = true; clearTimeout(job.timer);
    if (launching) await launching.catch(() => {});
    kill(job);
    if (job.child) { await sleep(150); try { process.kill(-job.child.pid, 'SIGKILL'); } catch {} }
    if (job.type === 'run' && code === 0 && fingerprint(job.root, job.files) !== job.fingerprint) { code = 1; error = 'worktree changed during tests; result invalid, rerun'; }
    if (job.usedBrowser) browserJobs++;
    if (code || job.cancelled) await recycle();
    if (job.temp) { try { rmSync(job.temp, { recursive: true, force: true }); } catch (failure) { code = 1; error = `temporary cleanup failed: ${failure.message}`; } }
    send(job.socket, { code, error, id: job.id }); job.socket.end();
    active = null; lastUsed = Date.now(); pump();
  }
  async function pump() {
    if (active || admitting || stopping || !waiting.length) return;
    admitting = true;
    const job = waiting[0];
    try {
      job.reason = pressure(job.root, job.env || {});
      if (job.reason) { if (browser) await recycle(); if (job.reason !== job.announcedReason) { send(job.socket, { event: `# TEST MANAGER waiting: ${job.reason}` }); job.announcedReason = job.reason; } return; }
      waiting.shift(); active = job; job.startedAt = Date.now();
      if (browser && (browserJobs >= 20 || Date.now() - browserBorn > 15 * 60_000)) await recycle();
      if (job.type === 'run' && fingerprint(job.root, job.files) !== job.fingerprint) return finish(job, 1, 'worktree changed while queued; resubmit the tests');
      const ws = job.type === 'lease' ? await endpoint(job) : null;
      if (job.finishing) return;
      if (job.cancelled) return finish(job, 1, 'cancelled');
      if (job.type === 'lease') {
        if (!ws) return finish(job, 1, 'playwright not installed');
        send(job.socket, { endpoint: ws, id: job.id });
      } else {
        send(job.socket, { event: `# TEST MANAGER running ${job.id}: ${job.files.length} file(s)` });
        job.temp = mkdtempSync(join(directory, 'job-'));
        const env = { ...job.env, WEAVE_TEST_MANAGER_DIR: directory, TMPDIR: job.temp, TMP: job.temp, TEMP: job.temp, NODE_TEST_CONTEXT: '', WEAVE_TEST_JOB: job.id, WEAVE_TEST_BROWSER_ENDPOINT: ws || '' };
        job.child = spawn(job.node || process.execPath, [join(job.root, 'scripts/test-manager.mjs'), '--worker', join(job.root, 'scripts/test.mjs'), ...job.flags, ...job.files], { cwd: job.root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        for (const stream of ['stdout', 'stderr']) job.child[stream].on('data', data => send(job.socket, { stream, data: data.toString('base64') }));
        job.child.once('error', error => finish(job, 1, error.message));
        job.child.once('close', code => finish(job, job.cancelled ? 1 : (code ?? 1), job.cancelled ? 'cancelled' : undefined));
      }
      job.timer = setTimeout(() => { job.cancelled = true; finish(job, 124, `job timeout after ${job.timeout} ms`); }, job.timeout);
    } catch (error) { if (active === job) finish(job, 1, error.message); else { waiting.shift(); send(job.socket, { code: 1, error: error.message }); job.socket.end(); } }
    finally { admitting = false; }
  }
  async function stop() {
    if (stopping) return; stopping = true;
    for (const job of waiting.splice(0)) { send(job.socket, { code: NOT_ADMITTED, error: 'manager stopped before admitting this job' }); job.socket.end(); }
    if (active) { active.cancelled = true; await finish(active, 1, 'manager stopped'); }
    await recycle(); clearInterval(tick); server.close();
  }
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    let submitted = false;
    lines(socket, msg => {
      if (submitted) throw new Error('one request per connection'); submitted = true;
      if (msg.type === 'status') { send(socket, { type: 'status', pid: process.pid, active: summary(active), queued: waiting.map(summary), browser: browser && { pid: browser.process().pid, jobs: browserJobs, born: browserBorn } }); return; }
      if (msg.type === 'browser') {
        if (!active || active.id !== msg.job || active.finishing) throw new Error('browser request has no active allocation');
        const job = active;
        endpoint(job).then(endpoint => {
          if (active !== job || job.finishing) send(socket, { code: 1, error: 'allocation ended' });
          else if (!endpoint) send(socket, { code: 1, error: 'playwright not installed' });
          else send(socket, { endpoint });
        }).catch(error => send(socket, { code: 1, error: error.message }));
        return;
      }
      if (msg.type === 'stop') { send(socket, { code: 0 }); stop(); return; }
      if (msg.type === 'cancel') {
        const job = [active, ...waiting].find(j => j?.id === msg.id);
        if (job === active && job) { job.cancelled = true; finish(job, 1, 'cancelled by request'); }
        else if (job) { waiting.splice(waiting.indexOf(job), 1); send(job.socket, { code: 1, error: 'cancelled by request' }); job.socket.end(); }
        send(socket, { code: job ? 0 : 1, error: job ? undefined : 'unknown job' }); return;
      }
      if (!['run', 'lease'].includes(msg.type) || !msg.root || !Array.isArray(msg.files) || (msg.type === 'run' && !msg.files.length)) throw new Error('invalid or empty test request');
      const job = { ...msg, id: randomUUID(), socket, queuedAt: Date.now(), timeout: jobTimeout(msg.timeout) };
      waiting.push(job); send(socket, { event: `# TEST MANAGER queued ${job.id}`, id: job.id });
      socket.once('close', () => {
        if (job.finishing) return;
        if (active === job) { job.cancelled = job.type !== 'lease'; finish(job, job.cancelled ? 1 : 0, job.cancelled ? 'client disconnected' : undefined); }
        else { const i = waiting.indexOf(job); if (i >= 0) waiting.splice(i, 1); }
      });
      pump();
    });
  });
  const tick = setInterval(() => {
    for (const job of [...waiting]) {
      const wait = queueWait(job.env);
      if (Date.now() - job.queuedAt <= wait) continue;
      waiting.splice(waiting.indexOf(job), 1);
      send(job.socket, { code: NOT_ADMITTED, error: `queue wait exceeded ${wait} ms; last admission check: ${job.reason || 'none yet'}` }); job.socket.end();
    }
    pump(); if (!active && !waiting.length && Date.now() - lastUsed > 5 * 60_000) stop();
  }, 2000);
  server.on('error', error => { clearInterval(tick); if (error.code !== 'EADDRINUSE') throw error; });
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    for (const name of readdirSync(directory)) if (/^job-[A-Za-z0-9]+$/.test(name)) {
      const path = join(directory, name);
      if (Date.now() - lstatSync(path).mtimeMs > 24 * 60 * 60_000) rmSync(path, { recursive: true, force: true });
    }
  });
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF && process.argv[2] === '--serve') await serve(process.argv[3]);

if (process.argv[1] && resolve(process.argv[1]) === SELF && process.argv[2] === '--worker') {
  const child = spawn(process.execPath, process.argv.slice(3), { stdio: 'inherit', env: process.env });
  let cleaning = false;
  const cleanup = () => {
    if (cleaning) return; cleaning = true;
    try { process.kill(-process.pid, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { if (process.env.TMPDIR?.startsWith(join(process.env.WEAVE_TEST_MANAGER_DIR || '/', 'job-'))) rmSync(process.env.TMPDIR, { recursive: true, force: true }); } catch {}
      try { process.kill(-process.pid, 'SIGKILL'); } catch {} process.exit(1);
    }, 500);
  };
  process.on('disconnect', cleanup); process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
  child.once('error', () => process.exit(1));
  child.once('close', code => { if (!cleaning) process.exit(code ?? 1); });
}
