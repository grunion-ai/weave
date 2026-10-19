import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { MAX_ROWS } from '../src/routes.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const OVER = 12;
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function busyWorkspace(w) {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  for (let i = 0; i < MAX_ROWS + OVER; i++) w.createEntity(t, { name: `t${i}` });
  return t;
}

test('the engine still answers every row to its own callers', () => {
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed();
  assert.ok(all.total > MAX_ROWS, `the fixture must exceed one page, got ${all.total}`);
  assert.equal(all.items.length, all.total, 'an in-process caller that names no limit reads the whole feed');
});

test('route and MCP answer one page when the caller names no limit (Issue #940)', async () => {
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed();

  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const feed = await (await fetch(`${base}/api/activity`)).json();
    assert.equal(feed.items.length, MAX_ROWS, 'GET /api/activity answers one page');
    assert.equal(feed.total, all.total, 'and total still counts every event');
    assert.deepEqual(feed.items.map((a) => a.id), all.items.slice(0, MAX_ROWS).map((a) => a.id),
      'the newest page, in feed order');
    const rest = await (await fetch(`${base}/api/activity?offset=${MAX_ROWS}`)).json();
    assert.deepEqual(rest.items.map((a) => a.id), all.items.slice(MAX_ROWS).map((a) => a.id),
      'offset still pages past the first page');
  } finally { server.close(); }

  const mcp = dispatchTool(w, 'weave_activity', {});
  assert.equal(mcp.items.length, MAX_ROWS, 'weave_activity answers one page');
  assert.equal(mcp.total, all.total, 'and names the full count so a client can page');
});

test('a caller that wants the whole log asks for limit -1 (Issue #940)', async () => {
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed();

  assert.equal(w.activityFeed({ limit: -1 }).items.length, all.total, 'the engine reads -1 as every row');
  assert.equal(dispatchTool(w, 'weave_activity', { limit: -1 }).items.length, all.total, 'weave_activity does too');

  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const feed = await (await fetch(`${base}/api/activity?limit=-1`)).json();
    assert.equal(feed.items.length, all.total, 'GET /api/activity?limit=-1 answers every row');
  } finally { server.close(); }
});

test('weave activity answers one page, and --limit -1 the whole log (Issue #940)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-actpage-'));
  try {
    const data = join(dir, 'ws.db');
    const fw = new Weave({ path: data });
    busyWorkspace(fw);
    fw.save?.();
    const cli = (...a) => JSON.parse(execFileSync('node', [BIN, ...a, '--data', data], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    const page = cli('activity');
    assert.ok(page.total > MAX_ROWS, `the fixture must exceed one page, got ${page.total}`);
    assert.equal(page.items.length, MAX_ROWS, 'weave activity prints one page');
    assert.equal(cli('activity', '--limit', '-1').items.length, page.total, 'weave activity --limit -1 prints the whole log');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEAVE_MAX_ROWS moves the default page on every surface', async () => {
  const prior = process.env.WEAVE_MAX_ROWS;
  process.env.WEAVE_MAX_ROWS = '40';
  const w = new Weave();
  busyWorkspace(w);
  try {
    assert.equal(dispatchTool(w, 'weave_activity', {}).items.length, 40, 'weave_activity reads the operator cap');
    const { server } = await startServer(w, { port: 0 });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const feed = await (await fetch(`${base}/api/activity`)).json();
      assert.equal(feed.items.length, 40, 'GET /api/activity reads it too');
    } finally { server.close(); }
  } finally {
    if (prior == null) delete process.env.WEAVE_MAX_ROWS; else process.env.WEAVE_MAX_ROWS = prior;
  }
});
