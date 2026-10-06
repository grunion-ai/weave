import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';
import { createRequestHandler } from '../../src/routes.js';
import { request } from '../../scripts/test-manager.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');

export function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

export function workspace(opts = {}) {
  const w = new Weave(opts);
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  return { w, t };
}

export function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  return { w, t };
}

export function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  return { w, tasks };
}

export function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  return { w, t };
}

export function normalise(v) {
  if (Array.isArray(v)) return v.map(normalise);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !['id', 'spaceId', 'url', 'entityCount'].includes(k) && !/Ids?$/.test(k))
    .map(([k, x]) => [k, normalise(x)]));
}

export function client(hub) {
  const handle = createRequestHandler(hub, { version: 'test' });
  return async (method, path, { body, token, cookie } = {}) => {
    const url = new URL(path, 'http://localhost:4400');
    const headers = { host: 'localhost:4400' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = `wv_session=${cookie}`;
    const res = await handle({
      method, path: decodeURIComponent(url.pathname), searchParams: url.searchParams,
      header: (n) => headers[n.toLowerCase()], readBody: async () => body ?? {}, remote: '127.0.0.1',
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch {}
    return { status: res.status, json };
  };
}

export async function withServer(fn) {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    await fn((path, opts) => fetch(`http://127.0.0.1:${port}${path}`, opts));
  } finally {
    server.close();
  }
}

export function managerHarness(prefix) {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const env = { ...process.env, WEAVE_TEST_MANAGER_DIR: scratch, WEAVE_TEST_JOB: '', NODE_TEST_CONTEXT: '', WEAVE_TEST_MIN_FREE_GB: '0', WEAVE_TEST_MIN_MEMORY_PERCENT: '0', WEAVE_TEST_MAX_LOAD: '99999' };
  test.after(async () => { await request({ type: 'stop' }, { directory: scratch }).catch(() => {}); rmSync(scratch, { recursive: true, force: true }); });
  const cli = (args, overrides = {}) => {
    const child = spawn(process.execPath, ['scripts/test.mjs', ...args], { cwd: ROOT, env: { ...env, ...overrides } });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    return { child, done: new Promise(resolve => child.on('close', code => resolve({ code, out }))) };
  };
  const fixture = (name, source) => { const path = join(scratch, `${name}.test.mjs`); writeFileSync(path, source); return path; };
  return { ROOT, scratch, env, cli, fixture };
}
