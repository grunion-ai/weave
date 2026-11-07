import test from 'node:test';
import { launch } from './lib/browser.mjs';
import { matrixWorld, matrixCases, file, KB, MB, LIMIT, MSG, TILE, RETRY, CHOOSE } from './lib/upload-matrix.mjs';

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
    expect: (n) => ({ landed: [], failed: [{ name: 'five-hundred.pdf', tile: TILE.server, retry: true }], toast: red(MSG.server(n['five-hundred.pdf']), RETRY) }) },
  { id: 'drop-502-html', entry: 'drop', files: [file('gateway.pdf', MB)], faults: { 'gateway.pdf': '502html' },
    expect: (n) => ({ landed: [], failed: [{ name: 'gateway.pdf', tile: TILE.unavailable, retry: true }], toast: red(MSG.unavailable(n['gateway.pdf']), RETRY) }) },
  { id: 'doc-504', entry: 'doc', files: [file('slow.pdf', 10 * KB)], faults: { 'slow.pdf': '504' },
    expect: (n) => ({ landed: [], failed: [{ name: 'slow.pdf', tile: TILE.unavailable, retry: true }], toast: red(MSG.unavailable(n['slow.pdf']), RETRY) }) },
  { id: 'picker-504-stored', entry: 'picker', files: [file('stored.pdf', 10 * KB)], faults: { 'stored.pdf': '504stored' },
    expect: () => ({ landed: ['stored.pdf'], failed: [], toast: null }) },
  { id: 'picker-offline-retry', entry: 'picker', files: [file('offline.pdf', 10 * KB)], faults: { 'offline.pdf': 'offline' }, retry: true,
    expect: (n) => ({ landed: [], failed: [{ name: 'offline.pdf', tile: TILE.offline, retry: true }], toast: red(MSG.offline(n['offline.pdf']), RETRY) }) },
  { id: 'picker-batch-middle-fails', entry: 'picker', files: [file('a.pdf', 10 * KB), file('b.pdf', 10 * KB), file('c.pdf', 10 * KB)], faults: { 'b.pdf': '500' },
    expect: () => ({ landed: ['a.pdf', 'c.pdf'], failed: [{ name: 'b.pdf', tile: TILE.server, retry: true }], toast: amber(MSG.oneFailed(2, 3, 'b.pdf', 'server error'), RETRY) }) },
  { id: 'drop-batch-middle-fails', entry: 'drop', files: [file('one.pdf', 100 * KB), file('two.pdf', 100 * KB), file('three.pdf', 100 * KB)], faults: { 'two.pdf': '502html' },
    expect: () => ({ landed: ['one.pdf', 'three.pdf'], failed: [{ name: 'two.pdf', tile: TILE.unavailable, retry: true }], toast: amber(MSG.oneFailed(2, 3, 'two.pdf', 'server unavailable'), RETRY) }) },
  { id: 'drop-mixed-batch', entry: 'drop', files: [file('fine.pdf', 10 * KB), file('huge.zip', 11 * MB, 'application/zip'), file('broken.pdf', 10 * KB)], faults: { 'broken.pdf': '500' },
    expect: () => ({ landed: ['fine.pdf'], failed: [{ name: 'huge.zip', tile: TILE.over, retry: false }, { name: 'broken.pdf', tile: TILE.server, retry: true }], toast: amber(MSG.someFailed(1, 3, 2), RETRY) }) },
  { id: 'drop-two-over-limit', entry: 'drop', files: [file('small.pdf', 10 * KB), file('big-1.zip', 11 * MB, 'application/zip'), file('big-2.zip', 12 * MB, 'application/zip')],
    expect: () => ({ landed: ['small.pdf'], failed: [{ name: 'big-1.zip', tile: TILE.over, retry: false }, { name: 'big-2.zip', tile: TILE.over, retry: false }], toast: amber(MSG.skipped(1, 3, 2), CHOOSE) }) },
  { id: 'picker-batch-lands', entry: 'picker', files: [file('x.pdf', 10 * KB), file('y.pdf', 10 * KB), file('z.pdf', 10 * KB)],
    expect: () => ({ landed: ['x.pdf', 'y.pdf', 'z.pdf'], failed: [], toast: { kind: 'success', text: MSG.many(3), action: null } }) },
  { id: 'doc-batch-middle-fails', entry: 'doc', files: [file('p.txt', 10 * KB, 'text/plain'), file('q.txt', 10 * KB, 'text/plain'), file('r.txt', 10 * KB, 'text/plain')], faults: { 'q.txt': '500' },
    expect: () => ({ landed: ['p.txt', 'r.txt'], failed: [{ name: 'q.txt', tile: TILE.server, retry: true }], toast: amber(MSG.oneFailed(2, 3, 'q.txt', 'server error'), RETRY) }) },
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
