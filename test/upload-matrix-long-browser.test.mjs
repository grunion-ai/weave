import test from 'node:test';
import { launch } from './lib/browser.mjs';
import { matrixWorld, matrixCases, file, KB, MB, LIMIT, MSG, TILE, RETRY } from './lib/upload-matrix.mjs';

const red = (text, action) => ({ kind: 'err', text, action });
const amber = (text, action = null) => ({ kind: 'warn', text, action });
const many = Array.from({ length: 25 }, (_, i) => file(`photo-${String(i + 1).padStart(2, '0')}.txt`, 10 * KB, 'text/plain'));

const SCENARIOS = [
  { id: 'picker-5m-slow', entry: 'picker', net: 'slow', files: [file('deck.pdf', 5 * MB)], timeout: 90_000,
    expect: () => ({ landed: ['deck.pdf'], failed: [], toast: null }) },
  { id: 'drop-1m-slow', entry: 'drop', net: 'slow', files: [file('contract.pdf', MB)],
    expect: () => ({ landed: ['contract.pdf'], failed: [], toast: null }) },
  { id: 'doc-5m-slow', entry: 'doc', net: 'slow', files: [file('handbook.pdf', 5 * MB)], timeout: 90_000,
    expect: () => ({ landed: ['handbook.pdf'], failed: [], toast: null }) },
  { id: 'doc-empty-slow', entry: 'doc', net: 'slow', files: [file('blank.txt', 0, 'text/plain')],
    expect: (n) => ({ landed: ['blank.txt'], failed: [], toast: amber(MSG.empty(n['blank.txt'])) }) },
  { id: 'picker-exact-limit', entry: 'picker', files: [file('exact.bin', LIMIT, 'application/octet-stream')],
    expect: () => ({ landed: ['exact.bin'], failed: [], toast: null }) },
  { id: 'doc-exact-limit', entry: 'doc', files: [file('exact.pdf', LIMIT)],
    expect: () => ({ landed: ['exact.pdf'], failed: [], toast: null }) },
  { id: 'picker-cut-midway', entry: 'picker', net: 'cut', files: [file('cut.pdf', 5 * MB)], retry: true, timeout: 120_000,
    expect: (n) => ({ landed: [], failed: [{ name: 'cut.pdf', tile: TILE.offline, retry: true }], toast: red(MSG.offline(n['cut.pdf']), RETRY) }) },
  { id: 'doc-cut-midway', entry: 'doc', net: 'cut', files: [file('cut-doc.pdf', 5 * MB)], timeout: 90_000,
    expect: (n) => ({ landed: [], failed: [{ name: 'cut-doc.pdf', tile: TILE.offline, retry: true }], toast: red(MSG.offline(n['cut-doc.pdf']), RETRY) }) },
  { id: 'picker-hang', entry: 'picker', clock: true, files: [file('hang.pdf', 10 * KB)], faults: { 'hang.pdf': 'hang' }, retry: true,
    expect: (n) => ({ landed: [], failed: [{ name: 'hang.pdf', tile: TILE.timeout, retry: true }], toast: red(MSG.timeout(n['hang.pdf']), RETRY) }) },
  { id: 'drop-hang-stored', entry: 'drop', clock: true, files: [file('kept.pdf', 10 * KB)], faults: { 'kept.pdf': 'hangStored' },
    expect: () => ({ landed: ['kept.pdf'], failed: [], toast: null }) },
  { id: 'picker-stall-timeout', entry: 'picker', net: 'stall', clock: true, files: [file('stall.pdf', 5 * MB)], timeout: 90_000,
    expect: (n) => ({ landed: [], failed: [{ name: 'stall.pdf', tile: TILE.timeout, retry: true }], toast: red(MSG.timeout(n['stall.pdf']), RETRY) }) },
  { id: 'drop-25-files', entry: 'drop', files: many, timeout: 120_000,
    expect: () => ({ landed: many.map((f) => f.name), failed: [], toast: { kind: 'success', text: MSG.many(25), action: null } }) },
  { id: 'drop-502-slow', entry: 'drop', net: 'slow', files: [file('gateway-slow.pdf', MB)], faults: { 'gateway-slow.pdf': '502html' },
    expect: (n) => ({ landed: [], failed: [{ name: 'gateway-slow.pdf', tile: TILE.restarting, retry: true }], toast: red(MSG.restarting(n['gateway-slow.pdf']), RETRY), waiting: true, tries: { 'gateway-slow.pdf': 4 } }) },
  { id: 'drop-502-slow-then-lands', entry: 'drop', net: 'slow', files: [file('restart-slow.pdf', MB)], faults: { 'restart-slow.pdf': '502twice' },
    expect: () => ({ landed: ['restart-slow.pdf'], failed: [], toast: null, waiting: true, tries: { 'restart-slow.pdf': 3 } }) },
  { id: 'doc-507-slow', entry: 'doc', net: 'slow', files: [file('full-doc.pdf', 200 * KB)], faults: { 'full-doc.pdf': '507' },
    expect: (n) => ({ landed: [], failed: [{ name: 'full-doc.pdf', tile: TILE.storage, retry: false }], toast: red(MSG.storage(n['full-doc.pdf']), null), tries: { 'full-doc.pdf': 1 } }) },
  { id: 'doc-batch-504-stored-slow', entry: 'doc', net: 'slow', files: [file('d1.txt', 100 * KB, 'text/plain'), file('d2.txt', 100 * KB, 'text/plain'), file('d3.txt', 100 * KB, 'text/plain')], faults: { 'd2.txt': '504stored' },
    expect: () => ({ landed: ['d1.txt', 'd2.txt', 'd3.txt'], failed: [], toast: { kind: 'success', text: MSG.many(3), action: null } }) },
  { id: 'picker-batch-slow-middle-offline', entry: 'picker', net: 'slow', files: [file('s1.pdf', 200 * KB), file('s2.pdf', 200 * KB), file('s3.pdf', 200 * KB)], faults: { 's2.pdf': 'offline' },
    expect: () => ({ landed: ['s1.pdf', 's3.pdf'], failed: [{ name: 's2.pdf', tile: TILE.offline, retry: true }], toast: amber(MSG.oneFailed(2, 3, 's2.pdf', 'no connection'), RETRY) }) },
  { id: 'drop-25-files-one-over', entry: 'drop', files: [...many.slice(0, 12), file('too-big.zip', 25 * MB, 'application/zip'), ...many.slice(12, 24)], timeout: 120_000,
    expect: () => ({ landed: many.slice(0, 24).map((f) => f.name), failed: [{ name: 'too-big.zip', tile: TILE.over, retry: false }], toast: amber(MSG.oneFailed(24, 25, 'too-big.zip', 'over 10 MB'), 'Choose another file') }) },
];

const world = matrixWorld(SCENARIOS);
const s = await launch('upload matrix (long)', world.seed, world.options);
for (const c of matrixCases(s, world, SCENARIOS)) test(...c);
