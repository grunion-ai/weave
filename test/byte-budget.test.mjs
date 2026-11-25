import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';
import { BUDGET_FILE, CODINGS, budgetUpdate, fit, firstPartyAssets, judge, servedBytes, unexplainedRaises } from './lib/bytes.mjs';
import { withServer } from './lib/fixtures.mjs';

const budget = JSON.parse(readFileSync(join(ROOT, BUDGET_FILE), 'utf8'));
const ASSETS = firstPartyAssets(join(ROOT, 'public'));

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
  await withServer(async ({ port }) => {
    const refusals = [];
    const measured = {};
    for (const path of ASSETS) {
      measured[path] = await servedBytes(port, path);
      for (const c of CODINGS) {
        const why = judge(path, c, measured[path][c], budget.bytes);
        if (why) refusals.push(why);
      }
    }
    assert.deepEqual(refusals, []);
  });
});

const LEDGER = { bytes: { '/app.js': { gzip: 1000, br: 900 }, '/old.js': { gzip: 10, br: 9 } }, raised: { '/old.js': 'Issue #1: it grew' } };

test('an update leaves a budget that still fits alone, so an unrelated change moves no number (Issue #1680)', () => {
  const same = budgetUpdate(LEDGER, { '/app.js': { gzip: 980, br: 880 }, '/old.js': { gzip: 10, br: 9 } });
  assert.deepEqual(same.bytes, LEDGER.bytes);
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.refusals, []);
  assert.deepEqual(same.raised, LEDGER.raised, 'an old reason stays with its asset');
});

test('an update lowers a budget the asset has outgrown downwards and adds a new asset at its own baseline (Issue #1680)', () => {
  const next = budgetUpdate(LEDGER, { '/app.js': { gzip: 500, br: 400 }, '/old.js': { gzip: 10, br: 9 }, '/new.js': { gzip: 100, br: 90 } });
  assert.deepEqual(next.bytes['/app.js'], { gzip: fit(500), br: fit(400) });
  assert.deepEqual(next.bytes['/new.js'], { gzip: fit(100), br: fit(90) });
  assert.deepEqual(next.refusals, []);
  assert.deepEqual(next.changes, [
    'lower bytes["/app.js"].gzip from 1,000 to 525 bytes',
    'lower bytes["/app.js"].br from 900 to 420 bytes',
    'add bytes["/new.js"].gzip at 105 bytes',
    'add bytes["/new.js"].br at 95 bytes',
  ]);
});

test('an update refuses to raise a budget with no reason and writes the reason it is given (Issue #1680)', () => {
  const bare = budgetUpdate(LEDGER, { '/app.js': { gzip: 1200, br: 900 }, '/old.js': { gzip: 10, br: 9 } });
  assert.deepEqual(bare.refusals, ['/app.js (gzip) serves 1,200 bytes against a budget of 1,000 bytes: pass --why "<reason>" to raise it']);
  assert.deepEqual(bare.bytes['/app.js'], LEDGER.bytes['/app.js'], 'a refused raise leaves the ledger alone');
  const given = budgetUpdate(LEDGER, { '/app.js': { gzip: 1200, br: 900 }, '/old.js': { gzip: 10, br: 9 } }, { why: 'Feature #900: the board view ships in app.js' });
  assert.deepEqual(given.refusals, []);
  assert.equal(given.bytes['/app.js'].gzip, fit(1200));
  assert.equal(given.raised['/app.js'], 'Feature #900: the board view ships in app.js');
  assert.deepEqual(unexplainedRaises(LEDGER, given), [], 'the written ledger passes the gate that reads it');
});

test('an update drops an asset the public directory no longer serves, and its reason with it (Issue #1680)', () => {
  const next = budgetUpdate(LEDGER, { '/app.js': { gzip: 1000, br: 900 } });
  assert.deepEqual(Object.keys(next.bytes), ['/app.js']);
  assert.deepEqual(next.raised, {});
  assert.deepEqual(next.changes, ['drop bytes["/old.js"], which public no longer serves']);
});

test('the ledger on disk is what measuring it again would write, so no bump waits for a red test (Issue #1680)', () => {
  const measured = Object.fromEntries(Object.entries(budget.bytes).map(([path, sizes]) => [path, { gzip: Math.round(sizes.gzip / 1.05), br: Math.round(sizes.br / 1.05) }]));
  const next = budgetUpdate(budget, measured);
  assert.deepEqual(next.refusals, []);
  assert.deepEqual(Object.keys(next.bytes).sort(), ASSETS, 'an update keeps the ledger covering every first-party asset');
});

test('an update keeps the key order the ledger already has, so one raise is a one-line diff (Issue #1680)', () => {
  const chronological = { bytes: { '/b.js': { gzip: 20, br: 18 }, '/a.js': { gzip: 10, br: 9 } }, raised: { '/b.js': 'Issue #2: b grew', '/a.js': 'Issue #1: a grew' } };
  const next = budgetUpdate(chronological, { '/b.js': { gzip: 20, br: 18 }, '/a.js': { gzip: 10, br: 9 }, '/c.js': { gzip: 5, br: 5 } });
  assert.deepEqual(Object.keys(next.bytes), ['/b.js', '/a.js', '/c.js'], 'the assets keep their order and a new one lands last');
  assert.deepEqual(Object.keys(next.raised), ['/b.js', '/a.js'], 'the reasons keep their order');
  const grown = budgetUpdate(chronological, { '/b.js': { gzip: 20, br: 18 }, '/a.js': { gzip: 40, br: 9 } }, { why: 'Issue #3: a grew again' });
  assert.deepEqual(Object.keys(grown.raised), ['/b.js', '/a.js'], 'a fresh reason replaces the old one in place');
  assert.equal(grown.raised['/a.js'], 'Issue #3: a grew again');
});

test('the committed ledger is byte-for-byte what an update of it writes (Issue #1680)', () => {
  const measured = Object.fromEntries(Object.entries(budget.bytes).map(([path, sizes]) => [path, { gzip: Math.round(sizes.gzip / 1.05), br: Math.round(sizes.br / 1.05) }]));
  const next = budgetUpdate(budget, measured);
  assert.deepEqual(next.changes, []);
  assert.equal(`${JSON.stringify({ ...budget, bytes: next.bytes, raised: next.raised }, null, 2)}\n`,
    readFileSync(join(ROOT, BUDGET_FILE), 'utf8'),
    'node scripts/byte-budget.mjs --write reproduces the committed file, so the command never reorders or reformats it');
});
