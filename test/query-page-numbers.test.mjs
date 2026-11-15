import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Weave, WeaveError } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { withServer } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const ROWS = 30;

function stocked() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  for (let i = 0; i < ROWS; i++) w.createEntity('S/T', { Name: `r${String(i).padStart(2, '0')}` });
  return w;
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/tables/S%2FT/query', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const names = (page) => page.items.map((i) => i.name);
const GOOD = [
  { offset: '1', limit: 5 },
  { offset: 1, limit: '5' },
  { offset: ' 1 ', limit: '5' },
];
const BAD = [
  { opts: { offset: 'x' }, says: /^offset must be a whole number of rows, not 'x'$/ },
  { opts: { offset: -1 }, says: /^offset must be a whole number of rows, not '-1'$/ },
  { opts: { offset: '1.5' }, says: /^offset must be a whole number of rows, not '1.5'$/ },
  { opts: { offset: true }, says: /^offset must be a whole number of rows, not 'true'$/ },
  { opts: { offset: '' }, says: /^offset must be a whole number of rows, not ''$/ },
  { opts: { limit: 'x' }, says: /^limit must be a whole number of rows, not 'x'$/ },
  { opts: { limit: 2.5 }, says: /^limit must be a whole number of rows, not '2.5'$/ },
  { opts: { limit: true }, says: /^limit must be a whole number of rows, not 'true'$/ },
  { opts: { limit: '' }, says: /^limit must be a whole number of rows, not ''$/ },
];

test('the engine pages a numeric string offset or limit as a number (Issue #1725)', () => {
  const w = stocked();
  for (const o of GOOD) {
    const page = w.query('S/T', { select: ['Name'], ...o });
    assert.deepEqual(names(page), ['r01', 'r02', 'r03', 'r04', 'r05'], JSON.stringify(o));
    assert.equal(page.nextOffset, 6, JSON.stringify(o));
  }
});

test('the engine refuses an offset or limit that is not a whole number, naming it (Issue #1725)', () => {
  const w = stocked();
  for (const c of BAD) {
    assert.throws(() => w.query('S/T', c.opts), (e) => e instanceof WeaveError && e.code === 'invalid' && c.says.test(e.message), JSON.stringify(c.opts));
  }
});

test('MCP weave_query applies the same rule (Issue #1725)', () => {
  const w = stocked();
  for (const o of GOOD) {
    assert.deepEqual(names(dispatchTool(w, 'weave_query', { db: 'S/T', select: ['Name'], ...o })), ['r01', 'r02', 'r03', 'r04', 'r05'], JSON.stringify(o));
  }
  for (const c of BAD.filter((b) => !('limit' in b.opts && (b.opts.limit === '' || b.opts.limit === 2.5 || b.opts.limit === true || b.opts.limit === 'x')))) {
    assert.throws(() => dispatchTool(w, 'weave_query', { db: 'S/T', ...c.opts }), (e) => e instanceof WeaveError && e.code === 'invalid' && c.says.test(e.message), JSON.stringify(c.opts));
  }
  for (const limit of ['x', 2.5, true, '']) {
    assert.throws(() => dispatchTool(w, 'weave_query', { db: 'S/T', limit }), (e) => e instanceof WeaveError && e.code === 'invalid' && /limit/.test(e.message), `limit ${limit}`);
  }
});

test('REST query applies the same rule (Issue #1725)', async () => {
  await withServer(stocked(), async ({ port }) => {
    for (const o of GOOD) {
      const res = await post(port, { select: ['Name'], ...o });
      assert.equal(res.status, 200, JSON.stringify(o));
      assert.deepEqual(names(res.json), ['r01', 'r02', 'r03', 'r04', 'r05'], JSON.stringify(o));
    }
    for (const c of BAD.filter((b) => !('limit' in b.opts && (b.opts.limit === '' || b.opts.limit === true || b.opts.limit === 'x')))) {
      const res = await post(port, c.opts);
      assert.equal(res.status, 400, JSON.stringify(c.opts));
      assert.match(res.json.error, c.says, JSON.stringify(c.opts));
    }
    const lots = await post(port, { limit: 'lots' });
    assert.equal(lots.status, 400);
  });
});

test('CLI query applies the same rule (Issue #1725)', () => {
  const data = join(tempDir('wv-page-'), 'w.db');
  const run = (...args) => spawnSync(process.execPath, ['bin/weave.js', '--data', data, ...args], { encoding: 'utf8', timeout: 120_000 });
  run('space', 'create', 'S');
  run('table', 'create', 'S', 'T');
  for (let i = 0; i < 8; i++) run('create', 'S/T', `r${i}`);
  const ok = run('query', 'S/T', '--select', 'Name', '--offset', '1', '--limit', '5');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).items.length, 5);
  const bad = run('query', 'S/T', '--offset', 'x');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /offset must be a whole number of rows/);
  const badLimit = run('query', 'S/T', '--limit', '2.5');
  assert.notEqual(badLimit.status, 0);
  assert.match(badLimit.stderr, /limit must be a whole number of rows/);
});
