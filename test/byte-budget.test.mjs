import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { ROOT } from './lib/source.mjs';
import { BUDGET_FILE, CODINGS, fit, firstPartyAssets, judge, unexplainedRaises } from './lib/bytes.mjs';

const budget = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8'));
const ASSETS = firstPartyAssets(join(ROOT, 'public'));

function get(port, path, encoding) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { 'Accept-Encoding': encoding } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, coding: res.headers['content-encoding'] ?? null, bytes: n }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function served(port, path) {
  const gzip = await get(port, path, 'gzip');
  assert.equal(gzip.status, 200, `${path} is served`);
  let br = await get(port, path, 'br, gzip');
  for (let i = 0; br.coding === 'gzip' && i < 600; i++) {
    await new Promise((r) => setTimeout(r, 50));
    br = await get(port, path, 'br, gzip');
  }
  assert.notEqual(br.coding, 'gzip', `${path} never came back as Brotli`);
  return { gzip: gzip.bytes, br: br.bytes };
}

test('a size at or a little under its budget passes', () => {
  assert.equal(judge('/app.js', 'br', 1000, { '/app.js': { br: 1000 } }), null);
  assert.equal(judge('/app.js', 'br', 960, { '/app.js': { br: 1000 } }), null);
});

test('a size over its budget is refused and names the way to merge it', () => {
  const why = judge('/app.js', 'gzip', 1001, { '/app.js': { gzip: 1000 } });
  assert.match(why, /\/app\.js \(gzip\) serves 1,001 bytes, budget 1,000 bytes/);
  assert.match(why, /raised\["\/app\.js"\]/);
  assert.match(why, /test\/byte-budget\.json/);
});

test('a size well under its budget asks for the budget to come down in the same change', () => {
  assert.match(judge('/app.js', 'br', 800, { '/app.js': { br: 1000 } }), new RegExp(`lower .* to ${fit(800)}`));
});

test('an asset with no budget is refused and told what to write', () => {
  assert.match(judge('/new.js', 'br', 100, {}), /add "\/new\.js": \{ "br": 105 \}/);
});

const BEFORE = { bytes: { '/app.js': { gzip: 1000, br: 900 } }, raised: {} };

test('a lower, equal or new budget needs no reason', () => {
  assert.deepEqual(unexplainedRaises(BEFORE, BEFORE), []);
  assert.deepEqual(unexplainedRaises(BEFORE, { bytes: { '/app.js': { gzip: 500, br: 400 } }, raised: {} }), []);
  assert.deepEqual(unexplainedRaises(BEFORE, { bytes: { ...BEFORE.bytes, '/new.js': { gzip: 9, br: 9 } }, raised: {} }), [], 'a new asset sets its own baseline');
  assert.deepEqual(unexplainedRaises(null, BEFORE), [], 'no budget file before this change');
});

test('a raised budget with no reason is refused; an old reason does not cover a second raise', () => {
  const after = { bytes: { '/app.js': { gzip: 1100, br: 900 } }, raised: {} };
  assert.deepEqual(unexplainedRaises(BEFORE, after), ['/app.js (gzip) rose from 1000 to 1100 bytes with no reason: write one under raised["/app.js"]']);
  assert.equal(unexplainedRaises(BEFORE, { ...after, raised: { '/app.js': ' ' } }).length, 1, 'a blank reason is no reason');
  const explained = { ...after, raised: { '/app.js': 'Feature #900: the board view ships in app.js' } };
  assert.deepEqual(unexplainedRaises(BEFORE, explained), []);
  assert.equal(unexplainedRaises(explained, { bytes: { '/app.js': { gzip: 1200, br: 900 } }, raised: explained.raised }).length, 1);
});

test('the budget file covers every first-party script and stylesheet, and no vendored file', () => {
  assert.ok(ASSETS.includes('/app.js') && ASSETS.includes('/style.css'));
  assert.ok(!ASSETS.some((p) => p.startsWith('/vendor/')));
  assert.deepEqual(Object.keys(budget.bytes).sort(), ASSETS);
  for (const sizes of Object.values(budget.bytes)) assert.deepEqual(Object.keys(sizes).sort(), [...CODINGS].sort());
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.bytes, `raised["${k}"] names no asset`);
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const budgetAt = (rev) => { try { return JSON.parse(git('show', `${rev}:${BUDGET_FILE}`)); } catch { return null; } };

test('this change raises no byte budget without a reason (Issue #1001)', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget), []);
});

test('every first-party asset serves within its byte budget after compression (Issue #1001)', { timeout: 300_000 }, async () => {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    const refusals = [];
    const measured = {};
    for (const path of ASSETS) {
      measured[path] = await served(port, path);
      for (const c of CODINGS) {
        const why = judge(path, c, measured[path][c], budget.bytes);
        if (why) refusals.push(why);
      }
    }
    assert.deepEqual(refusals, []);
  } finally { server.close(); }
});
