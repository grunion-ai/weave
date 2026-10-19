import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, ACTIVITY_PAGE } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';

const OVER = 12;
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function busyWorkspace(w) {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  for (let i = 0; i < 500 + OVER; i++) w.createEntity(t, { name: `t${i}` });
  return t;
}

test('the engine answers one page of 500 when the caller names no limit, and -1 for every row (Issue #940)', () => {
  assert.equal(ACTIVITY_PAGE, 500, 'the page the web UI already asks for');
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed({ limit: -1 });
  assert.ok(all.total > ACTIVITY_PAGE, `the fixture must exceed one page, got ${all.total}`);
  assert.equal(all.items.length, all.total, '-1 reads every row');
  const page = w.activityFeed();
  assert.equal(page.items.length, ACTIVITY_PAGE, 'no limit reads one page');
  assert.equal(page.total, all.total, 'total still counts every event');
  assert.deepEqual(page.items.map((a) => a.id), all.items.slice(0, ACTIVITY_PAGE).map((a) => a.id), 'the newest page, in feed order');
  assert.equal(w.activityFeed({ limit: null }).items.length, ACTIVITY_PAGE, 'an explicit null is no limit too');
  assert.deepEqual(w.activityFeed({ offset: ACTIVITY_PAGE }).items.map((a) => a.id), all.items.slice(ACTIVITY_PAGE).map((a) => a.id), 'offset pages past the first page');
});

test('GET /api/activity answers one page by default and every row for limit=-1 (Issue #940)', async () => {
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed({ limit: -1 });
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const feed = await (await fetch(`${base}/api/activity`)).json();
    assert.equal(feed.items.length, ACTIVITY_PAGE, 'one page');
    assert.equal(feed.total, all.total, 'total counts every event');
    const rest = await (await fetch(`${base}/api/activity?offset=${ACTIVITY_PAGE}`)).json();
    assert.equal(rest.items.length, all.total - ACTIVITY_PAGE, 'offset pages past it');
    const whole = await (await fetch(`${base}/api/activity?limit=-1`)).json();
    assert.equal(whole.items.length, all.total, 'limit=-1 answers every row');
  } finally { server.close(); }
});

test('weave_activity answers one page by default, every row for -1, and says so (Issue #940)', () => {
  const w = new Weave();
  busyWorkspace(w);
  const all = w.activityFeed({ limit: -1 });
  const mcp = dispatchTool(w, 'weave_activity', {});
  assert.equal(mcp.items.length, ACTIVITY_PAGE, 'one page');
  assert.equal(mcp.total, all.total, 'total names the full count');
  assert.equal(dispatchTool(w, 'weave_activity', { limit: -1 }).items.length, all.total, '-1 answers every row');
  const tool = TOOLS.find((t) => t.name === 'weave_activity');
  assert.match(tool.description, /500/, 'the description names the default page');
  assert.match(tool.description, /-1/, 'and the way to ask for every row');
});

test('weave activity prints one page by default, --limit -1 prints the whole log, and help says so (Issue #940)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-actpage-'));
  try {
    const data = join(dir, 'ws.db');
    const fw = new Weave({ path: data });
    busyWorkspace(fw);
    fw.save?.();
    const cli = (...a) => JSON.parse(execFileSync('node', [BIN, ...a, '--data', data], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    const page = cli('activity');
    assert.ok(page.total > ACTIVITY_PAGE, `the fixture must exceed one page, got ${page.total}`);
    assert.equal(page.items.length, ACTIVITY_PAGE, 'one page');
    assert.equal(cli('activity', '--limit', '-1').items.length, page.total, '--limit -1 prints the whole log');
    const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
    const line = help.split('\n').findIndex((l) => /^\s+activity \[<id>\]/.test(l));
    assert.ok(line >= 0, 'help lists activity');
    assert.match(help.split('\n').slice(line, line + 2).join('\n'), /500[\s\S]*-1/, 'help names the default page and -1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
