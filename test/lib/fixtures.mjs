/* Fixtures the suites share: a few small workspaces, an in-process route
   client, a throwaway server, and the test-manager CLI harness. Each one was
   copied byte for byte into two to seven suites (Issue #648); they live here
   now, once, and a suite imports the one it uses. */
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

/* ---------- workspaces ---------- */

// Dev/Task, nothing else.
export function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

// Ops/Ticket; opts reach the Weave constructor.
export function workspace(opts = {}) {
  const w = new Weave(opts);
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  return { w, t };
}

// Ops/Task.
export function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  return { w, t };
}

// Product/Task.
export function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  return { w, tasks };
}

// Sales/Deals with a number field, Amount.
export function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  return { w, t };
}

// A schema with what is the source's own (ids, urls, counts) stripped: what is left must match.
export function normalise(v) {
  if (Array.isArray(v)) return v.map(normalise);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !['id', 'spaceId', 'url', 'entityCount'].includes(k) && !/Ids?$/.test(k))
    .map(([k, x]) => [k, normalise(x)]));
}

/* ---------- servers ---------- */

/* The route handler without a socket: call(method, path, { body, token,
   cookie }) answers { status, json }. */
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
    try { json = JSON.parse(res.body); } catch { /* not json */ }
    return { status: res.status, json };
  };
}

// An empty workspace on a free port; fn gets a fetch bound to it.
export async function withServer(fn) {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    await fn((path, opts) => fetch(`http://127.0.0.1:${port}${path}`, opts));
  } finally {
    server.close();
  }
}

/* ---------- the test manager ---------- */

/* A private manager directory with admission wide open, stopped and removed
   after the suite. cli(args) runs scripts/test.mjs against it; fixture()
   writes a throwaway suite into it. */
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
