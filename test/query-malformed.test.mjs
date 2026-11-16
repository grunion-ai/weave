import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Weave, WeaveError } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { withServer } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

const CASES = [
  { name: 'a null where node', opts: { where: [null] }, says: /where\[0\]/ },
  { name: 'a scalar where node', opts: { where: [7] }, says: /where\[0\]/ },
  { name: 'a condition with one element', opts: { where: [['Name']] }, says: /where\[0\]/ },
  { name: 'a condition with a non-string path', opts: { where: [[3, '=', 'x']] }, says: /where\[0\]/ },
  { name: 'a condition with a non-string operator', opts: { where: [['Name', 3, 'x']] }, says: /where\[0\]/ },
  { name: 'and holding a non-array', opts: { where: { and: 'x' } }, says: /where\.and/ },
  { name: 'a nested or holding a non-array', opts: { where: [{ or: [{ and: 4 }] }] }, says: /where\[0\]\.or\[0\]\.and/ },
  { name: 'a group with neither and nor or', opts: { where: [{ not: [['Name', '=', 'x']] }] }, says: /where\[0\]/ },
  { name: 'a group with both and and or', opts: { where: [{ and: [], or: [] }] }, says: /where\[0\]/ },
  { name: 'a where that is a string', opts: { where: 'Name' }, says: /where/ },
  { name: 'a sort that is a number', opts: { sort: 5 }, says: /sort/ },
  { name: 'a null sort item', opts: { sort: [null] }, says: /sort\[0\]/ },
  { name: 'a sort item with no field', opts: { sort: [{ dir: 'asc' }] }, says: /sort\[0\]/ },
  { name: 'a sort item with a non-string field', opts: { sort: [{ field: 3 }] }, says: /sort\[0\]/ },
  { name: 'a sort item with a bad direction', opts: { sort: [{ field: 'Name', dir: 'up' }] }, says: /sort\[0\]/ },
];

function stocked() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'Task' });
  w.createEntity('S/Task', { Name: 'a' });
  return w;
}

function post(port, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/tables/S%2FTask/query', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

for (const c of CASES) {
  test(`engine query refuses ${c.name} as invalid, naming the path (Issue #1720)`, () => {
    const w = stocked();
    assert.throws(() => w.query('S/Task', c.opts), (e) => e instanceof WeaveError && e.code === 'invalid' && c.says.test(e.message));
  });
}

test('MCP weave_query reports each malformed document as an invalid error (Issue #1720)', () => {
  const w = stocked();
  for (const c of CASES) {
    assert.throws(() => dispatchTool(w, 'weave_query', { db: 'S/Task', ...c.opts }), (e) => e instanceof WeaveError && e.code === 'invalid' && c.says.test(e.message), c.name);
  }
});

test('REST query answers 400 naming the path for each malformed document (Issue #1720)', async () => {
  await withServer(stocked(), async ({ port }) => {
    for (const c of CASES) {
      const res = await post(port, c.opts);
      assert.equal(res.status, 400, c.name);
      assert.match(res.json.error, c.says, c.name);
    }
  });
});

test('CLI query exits with the invalid code and names the path (Issue #1720)', () => {
  const data = join(tempDir('wv-malformed-'), 'w.db');
  const run = (...args) => spawnSync(process.execPath, ['bin/weave.js', '--data', data, ...args], { encoding: 'utf8', timeout: 120_000 });
  run('space', 'create', 'S');
  run('table', 'create', 'S', 'Task');
  const bad = run('query', 'S/Task', '--where', '[null]');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /error \[invalid\].*where\[0\]/);
  const good = run('query', 'S/Task', '--where', '[["Name","contains","x"]]');
  assert.equal(good.status, 0);
});

test('well-formed where and sort documents still run (Issue #1720)', () => {
  const w = stocked();
  const page = w.query('S/Task', { where: [['Name', '=', 'a'], { or: [['Name', '=', 'a'], { and: [] }] }], sort: ['Name', { field: 'Name', dir: 'desc' }] });
  assert.equal(page.total, 1);
});
