import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { matrixWorld, matrixCases, file, KB, MB, LIMIT, MSG, TILE, RETRY, CHOOSE, ERROR_ID } from './lib/upload-matrix.mjs';

const LONG = `${'board-pack-'.repeat(18)}final.pdf`;
const UNICODE = 'Résumé 日本語 📄 v2.pdf';
const SPACED = 'quarterly  report   final copy.pdf';
const red = (text, action) => ({ kind: 'err', text, action });
const amber = (text, action = null) => ({ kind: 'warn', text, action });

const SCENARIOS = [
  { id: 'picker-10k', entry: 'picker', files: [file('notes.txt', 10 * KB, 'text/plain')],
    expect: () => ({ landed: ['notes.txt'], failed: [], toast: null }) },
  { id: 'picker-empty', entry: 'picker', files: [file('empty.txt', 0, 'text/plain')],
    expect: (n) => ({ landed: ['empty.txt'], failed: [], toast: amber(MSG.empty(n['empty.txt'])) }) },
  { id: 'drop-1m', entry: 'drop', files: [file('contract.pdf', MB)],
    expect: () => ({ landed: ['contract.pdf'], failed: [], toast: null }) },
  { id: 'doc-10k', entry: 'doc', files: [file('read.txt', 10 * KB, 'text/plain')],
    expect: () => ({ landed: ['read.txt'], failed: [], toast: null }) },
  { id: 'picker-over-by-one', entry: 'picker', files: [file('report.pdf', LIMIT + 1)],
    expect: (n) => ({ landed: [], failed: [{ name: 'report.pdf', tile: TILE.over, retry: false }], toast: red(MSG.over(n['report.pdf'], '10.1 MB'), CHOOSE) }) },
  { id: 'drop-25m', entry: 'drop', files: [file('export.zip', 25 * MB, 'application/zip')],
    expect: (n) => ({ landed: [], failed: [{ name: 'export.zip', tile: TILE.over, retry: false }], toast: red(MSG.over(n['export.zip'], '25 MB'), CHOOSE) }) },
  { id: 'doc-25m', entry: 'doc', files: [file('scan.pdf', 25 * MB)],
    expect: (n) => ({ landed: [], failed: [{ name: 'scan.pdf', tile: TILE.over, retry: false }], toast: red(MSG.over(n['scan.pdf'], '25 MB'), CHOOSE) }) },
  { id: 'picker-413', entry: 'picker', files: [file('big.pdf', 2 * MB)], faults: { 'big.pdf': '413' },
    expect: (n) => ({ landed: [], failed: [{ name: 'big.pdf', tile: TILE.over, retry: false }], toast: red(MSG.over(n['big.pdf'], '2 MB'), CHOOSE) }) },
  { id: 'picker-500-retry', entry: 'picker', files: [file('five-hundred.pdf', 10 * KB)], faults: { 'five-hundred.pdf': '500' }, retry: true,
    expect: (n) => ({ landed: [], failed: [{ name: 'five-hundred.pdf', tile: TILE.server, retry: true, mono: ERROR_ID }], toast: red(MSG.server(n['five-hundred.pdf']), RETRY), mono: ERROR_ID, waiting: false, tries: { 'five-hundred.pdf': 1 } }) },
  { id: 'drop-502-html', entry: 'drop', files: [file('gateway.pdf', MB)], faults: { 'gateway.pdf': '502html' },
    expect: (n) => ({ landed: [], failed: [{ name: 'gateway.pdf', tile: TILE.restarting, retry: true }], toast: red(MSG.restarting(n['gateway.pdf']), RETRY), waiting: true, tries: { 'gateway.pdf': 4 } }) },
  { id: 'picker-502-then-lands', entry: 'picker', files: [file('restart.pdf', 10 * KB)], faults: { 'restart.pdf': '502twice' },
    expect: () => ({ landed: ['restart.pdf'], failed: [], toast: null, waiting: true, tries: { 'restart.pdf': 3 } }) },
  { id: 'picker-503-every-try', entry: 'picker', files: [file('down.pdf', 10 * KB)], faults: { 'down.pdf': '503' }, retry: true,
    expect: (n) => ({ landed: [], failed: [{ name: 'down.pdf', tile: TILE.restarting, retry: true }], toast: red(MSG.restarting(n['down.pdf']), RETRY), waiting: true, tries: { 'down.pdf': 4 } }) },
  { id: 'picker-507-storage-full', entry: 'picker', files: [file('full.pdf', 10 * KB)], faults: { 'full.pdf': '507' },
    expect: (n) => ({ landed: [], failed: [{ name: 'full.pdf', tile: TILE.storage, retry: false }], toast: red(MSG.storage(n['full.pdf']), null), waiting: false, tries: { 'full.pdf': 1 } }) },
  { id: 'doc-504', entry: 'doc', files: [file('slow.pdf', 10 * KB)], faults: { 'slow.pdf': '504' },
    expect: (n) => ({ landed: [], failed: [{ name: 'slow.pdf', tile: TILE.timeout, retry: true }], toast: red(MSG.timeout(n['slow.pdf']), RETRY), waiting: false, tries: { 'slow.pdf': 1 } }) },
  { id: 'picker-504-stored', entry: 'picker', files: [file('stored.pdf', 10 * KB)], faults: { 'stored.pdf': '504stored' },
    expect: () => ({ landed: ['stored.pdf'], failed: [], toast: null }) },
  { id: 'picker-offline-retry', entry: 'picker', files: [file('offline.pdf', 10 * KB)], faults: { 'offline.pdf': 'offline' }, retry: true,
    expect: (n) => ({ landed: [], failed: [{ name: 'offline.pdf', tile: TILE.offline, retry: true }], toast: red(MSG.offline(n['offline.pdf']), RETRY) }) },
  { id: 'picker-batch-middle-fails', entry: 'picker', files: [file('a.pdf', 10 * KB), file('b.pdf', 10 * KB), file('c.pdf', 10 * KB)], faults: { 'b.pdf': '500' },
    expect: () => ({ landed: ['a.pdf', 'c.pdf'], failed: [{ name: 'b.pdf', tile: TILE.server, retry: true, mono: ERROR_ID }], toast: amber(MSG.oneFailed(2, 3, 'b.pdf', `error ${ERROR_ID}`), RETRY), mono: ERROR_ID }) },
  { id: 'drop-batch-middle-fails', entry: 'drop', files: [file('one.pdf', 100 * KB), file('two.pdf', 100 * KB), file('three.pdf', 100 * KB)], faults: { 'two.pdf': '502html' },
    expect: () => ({ landed: ['one.pdf', 'three.pdf'], failed: [{ name: 'two.pdf', tile: TILE.restarting, retry: true }], toast: amber(MSG.restartingInBatch(2, 3, 'two.pdf'), RETRY), waiting: true, tries: { 'two.pdf': 4 } }) },
  { id: 'drop-mixed-batch', entry: 'drop', files: [file('fine.pdf', 10 * KB), file('huge.zip', 11 * MB, 'application/zip'), file('broken.pdf', 10 * KB)], faults: { 'broken.pdf': '500' },
    expect: () => ({ landed: ['fine.pdf'], failed: [{ name: 'huge.zip', tile: TILE.over, retry: false }, { name: 'broken.pdf', tile: TILE.server, retry: true }], toast: amber(MSG.someFailed(1, 3, 2), RETRY) }) },
  { id: 'drop-two-over-limit', entry: 'drop', files: [file('small.pdf', 10 * KB), file('big-1.zip', 11 * MB, 'application/zip'), file('big-2.zip', 12 * MB, 'application/zip')],
    expect: () => ({ landed: ['small.pdf'], failed: [{ name: 'big-1.zip', tile: TILE.over, retry: false }, { name: 'big-2.zip', tile: TILE.over, retry: false }], toast: amber(MSG.skipped(1, 3, 2), CHOOSE) }) },
  { id: 'picker-batch-lands', entry: 'picker', files: [file('x.pdf', 10 * KB), file('y.pdf', 10 * KB), file('z.pdf', 10 * KB)],
    expect: () => ({ landed: ['x.pdf', 'y.pdf', 'z.pdf'], failed: [], toast: { kind: 'success', text: MSG.many(3), action: null } }) },
  { id: 'doc-batch-middle-fails', entry: 'doc', files: [file('p.txt', 10 * KB, 'text/plain'), file('q.txt', 10 * KB, 'text/plain'), file('r.txt', 10 * KB, 'text/plain')], faults: { 'q.txt': '500' },
    expect: () => ({ landed: ['p.txt', 'r.txt'], failed: [{ name: 'q.txt', tile: TILE.server, retry: true, mono: ERROR_ID }], toast: amber(MSG.oneFailed(2, 3, 'q.txt', `error ${ERROR_ID}`), RETRY), mono: ERROR_ID }) },
  { id: 'doc-413', entry: 'doc', files: [file('refused.pdf', MB)], faults: { 'refused.pdf': '413' },
    expect: (n) => ({ landed: [], failed: [{ name: 'refused.pdf', tile: TILE.over, retry: false }], toast: red(MSG.over(n['refused.pdf'], '1 MB'), CHOOSE) }) },
  { id: 'picker-long-name', entry: 'picker', files: [file(LONG, 10 * KB)],
    expect: () => ({ landed: [LONG], failed: [], toast: null }) },
  { id: 'picker-long-name-500', entry: 'picker', files: [file(LONG, 10 * KB)], faults: { [LONG]: '500' },
    expect: (n) => ({ landed: [], failed: [{ name: LONG, tile: TILE.server, retry: true }], toast: red(MSG.server(n[LONG]), RETRY) }) },
  { id: 'drop-unicode', entry: 'drop', files: [file(UNICODE, 10 * KB)],
    expect: () => ({ landed: [UNICODE], failed: [], toast: null }) },
  { id: 'doc-spaced-name', entry: 'doc', files: [file(SPACED, 10 * KB)],
    expect: () => ({ landed: [SPACED], failed: [], toast: null }) },
];

const world = matrixWorld(SCENARIOS);
const s = await launch('upload matrix (core)', world.seed, world.options);
for (const c of matrixCases(s, world, SCENARIOS)) test(...c);

const html = (status) => ({ status, contentType: 'text/html', body: `<html><body><h1>${status}</h1></body></html>` });
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

if (s) test('a record save or read that meets a restart, a full disk or a bug says which (Issue #1413)', async () => {
  const context = await s.browser.newContext();
  const page = await context.newPage();
  try {
    const id = world.rows['picker-10k'].id;
    await page.goto(`${s.base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.attach-box');
    const before = JSON.stringify(s.weave.getEntity(id).values);
    let next = null;
    await page.route(`**/api/entities/${id}`, (route) => (next ? route.fulfill(next) : route.continue()));
    const said = async (method, answer) => {
      next = answer;
      const message = await page.evaluate(([verb, row]) => { warmGets.clear(); return api(verb, `/entities/${row}`, verb === 'GET' ? undefined : { Name: 'renamed' }).then(() => 'saved', (e) => e.message); }, [method, id]);
      next = null;
      return message;
    };
    assert.equal(await said('PATCH', html(502)), 'The weave server is restarting, so nothing was saved. Try again in a minute.');
    assert.equal(await said('GET', html(503)), 'The weave server is restarting. Try again in a minute.');
    assert.equal(await said('PATCH', json(507, { error: 'The weave server is out of storage, so nothing was saved. Ask whoever runs your weave to add storage.', code: 'storage-full' })), 'The weave server is out of storage, so nothing was saved. Ask whoever runs your weave to add storage.');
    assert.equal(await said('PATCH', json(500, { error: 'Internal error (request 9f8e7d6c)', code: 'internal', id: '9f8e7d6c' })), 'The weave server hit a bug, so nothing was saved. Include error 9f8e7d6c when you report it to whoever runs your weave.');
    assert.equal(JSON.stringify(s.weave.getEntity(id).values), before, 'no failed save reached the row');
  } finally {
    await context.close().catch(() => {});
  }
});
