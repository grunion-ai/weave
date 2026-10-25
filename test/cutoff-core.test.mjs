import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CELLS, KINDS, NOTE, PLATFORM, cellOf, fingerprint, grew, lower, ratchet, sectionOf, tally, verdict } from './lib/cutoff.mjs';
import { OVERLAYS } from './lib/overlays.mjs';
import { ROUTES } from './lib/states.mjs';
import { JOURNEYS, cellsOf } from './lib/journeys.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILE = 'test/cutoff-baseline.json';
const baseline = JSON.parse(readFileSync(new URL('./cutoff-baseline.json', import.meta.url), 'utf8'));
const f = (kind, selector, extra = {}) => ({ kind, selector, text: 'x', px: 9, ...extra });

test('a fingerprint is the kind plus the selector with every number folded to #', () => {
  assert.equal(fingerprint(f('ellipsis', 'div#cmdk-opt-12.result > span.cmdk-text')), 'ellipsis|div#cmdk-opt-#.result > span.cmdk-text');
  assert.equal(fingerprint(f('clipped', 'tr.row-3 > td.c10')), 'clipped|tr.row-# > td.c#');
  assert.equal(fingerprint(f('clipped', 'div#e-0b6c3f2a-1d2e-4f50-9a8b-7c6d5e4f3a21 > span')), 'clipped|div#e-# > span', 'a row id is one token, not a run of digits');
});

test('a fingerprint names the phone cell and leaves the desktop cell bare', () => {
  assert.equal(fingerprint(f('field-value', 'input.f'), 'phone'), 'field-value|input.f|phone');
  assert.equal(fingerprint(f('field-value', 'input.f'), 'desktop'), 'field-value|input.f');
  assert.equal(fingerprint(f('field-value', 'input.f')), 'field-value|input.f');
  assert.equal(cellOf('field-value|input.f|phone'), 'phone');
  assert.equal(cellOf('field-value|input.f'), 'desktop');
});

test('tally counts instances per fingerprint and cell, in key order', () => {
  const got = tally([f('ellipsis', 'span.k-label'), f('ellipsis', 'span.k-label'), f('ellipsis', 'span.k-label', { cell: 'phone' }), f('clipped', 'td.c1'), f('clipped', 'td.c2')]);
  assert.deepEqual(got, { 'clipped|td.c#': 2, 'ellipsis|span.k-label': 2, 'ellipsis|span.k-label|phone': 1 });
  assert.deepEqual(Object.keys(got), Object.keys(got).toSorted());
});

test('ratchet rejects a fingerprint the baseline does not hold', () => {
  const { added, dropped } = ratchet({ 'ellipsis|span.a': 1 }, { [NOTE]: 'doc' });
  assert.deepEqual(added, [{ fp: 'ellipsis|span.a', seen: 1, baseline: 0 }]);
  assert.deepEqual(dropped, []);
});

test('ratchet rejects more instances of a known fingerprint than the baseline holds', () => {
  assert.deepEqual(ratchet({ 'ellipsis|span.a': 5 }, { 'ellipsis|span.a': 4 }).added, [{ fp: 'ellipsis|span.a', seen: 5, baseline: 4 }]);
});

test('ratchet names a fingerprint that measured fewer than the baseline: gone, or fewer', () => {
  const { added, dropped } = ratchet({ 'ellipsis|span.a': 2 }, { 'ellipsis|span.a': 4, 'clipped|td.b': 3 });
  assert.deepEqual(added, []);
  assert.deepEqual(dropped, [{ fp: 'ellipsis|span.a', seen: 2, baseline: 4 }, { fp: 'clipped|td.b', seen: 0, baseline: 3 }]);
});

test('ratchet passes when the page matches the baseline exactly and ignores the note', () => {
  assert.deepEqual(ratchet({ 'ellipsis|span.a': 4 }, { [NOTE]: 'doc', 'ellipsis|span.a': 4 }), { added: [], dropped: [] });
});

test('verdict blocks growth and reads a lower count as a stale baseline, never a failure (Issue #1103)', () => {
  const base = { [NOTE]: 'doc', 'ellipsis|span.crumb-nm': 8, 'clipped|td.b': 3 };
  assert.deepEqual(verdict({ 'ellipsis|span.crumb-nm': 5, 'clipped|td.b': 3 }, base), {
    added: [],
    stale: [{ fp: 'ellipsis|span.crumb-nm', seen: 5, baseline: 8 }],
  }, 'one commit measured this breadcrumb 5, 7 and 8 times: the low run is not a fix');
  assert.deepEqual(verdict({ 'ellipsis|span.crumb-nm': 9, 'clipped|td.b': 3 }, base).added, [{ fp: 'ellipsis|span.crumb-nm', seen: 9, baseline: 8 }], 'a count over the baseline still blocks');
  assert.deepEqual(verdict({}, base), { added: [], stale: [{ fp: 'ellipsis|span.crumb-nm', seen: 0, baseline: 8 }, { fp: 'clipped|td.b', seen: 0, baseline: 3 }] });
});

test('verdict judges only the cells it is told were walked', () => {
  const base = { 'ellipsis|span.a': 1, 'ellipsis|span.a|phone': 2 };
  assert.deepEqual(verdict({ 'ellipsis|span.a': 2 }, base, { cells: ['desktop'] }), { added: [{ fp: 'ellipsis|span.a', seen: 2, baseline: 1 }], stale: [] });
  assert.deepEqual(verdict({ 'ellipsis|span.a': 1 }, base, { cells: ['desktop'] }), { added: [], stale: [] }, 'the phone baseline is not judged by a desktop run');
});

test('ratchet judges only the cells it is told were walked', () => {
  const seen = { 'ellipsis|span.a': 1 };
  const base = { 'ellipsis|span.a': 1, 'ellipsis|span.a|phone': 2 };
  assert.deepEqual(ratchet(seen, base, { cells: ['desktop'] }), { added: [], dropped: [] });
  assert.deepEqual(ratchet(seen, base).dropped, [{ fp: 'ellipsis|span.a|phone', seen: 0, baseline: 2 }]);
});

test('grew names every fingerprint that is new or counts higher, per platform, and nothing that shrank', () => {
  const before = { [NOTE]: 'a', linux: { 'ellipsis|span.a': 4, 'clipped|td.b': 3 } };
  assert.deepEqual(grew(before, { [NOTE]: 'b', linux: { 'ellipsis|span.a': 2 } }), []);
  assert.deepEqual(grew(before, { linux: { 'ellipsis|span.a': 5, 'clipped|td.b': 3, 'line-clamp|p.c': 1 } }), [
    { platform: 'linux', fp: 'ellipsis|span.a', before: 4, after: 5 },
    { platform: 'linux', fp: 'line-clamp|p.c', before: 0, after: 1 },
  ]);
  assert.deepEqual(grew(before, { ...before, darwin: { 'ellipsis|span.a': 9 } }), [], 'a platform measured for the first time seeds its own section');
  assert.deepEqual(grew(null, { linux: { 'ellipsis|span.a': 5 } }), [], 'the commit that seeds the baseline has nothing to grow from');
});

test('sectionOf reads one platform and treats a missing platform as an empty baseline', () => {
  const file = { [NOTE]: 'doc', linux: { 'ellipsis|span.a': 1 } };
  assert.deepEqual(sectionOf(file, 'linux'), { 'ellipsis|span.a': 1 });
  assert.deepEqual(sectionOf(file, 'win32'), {});
  assert.equal(PLATFORM, process.platform);
});

test('lower only ever shrinks a platform section, and seeds one that is missing', () => {
  const file = { [NOTE]: 'doc', linux: { 'ellipsis|span.a': 4, 'clipped|td.b': 3, 'clipped|td.b|phone': 2 }, darwin: { 'ellipsis|span.a': 7 } };
  const counts = { 'ellipsis|span.a': 2, 'line-clamp|p.c': 5, 'clipped|td.b|phone': 9 };
  assert.deepEqual(lower(file, counts, { cells: ['desktop', 'phone'], platform: 'linux' }), {
    [NOTE]: 'doc', linux: { 'ellipsis|span.a': 2, 'clipped|td.b|phone': 2 }, darwin: { 'ellipsis|span.a': 7 },
  });
  assert.deepEqual(lower(file, counts, { cells: ['desktop'], platform: 'linux' }).linux, { 'ellipsis|span.a': 2, 'clipped|td.b|phone': 2 }, 'a cell that was not walked keeps its counts');
  assert.deepEqual(lower(file, counts, { cells: ['desktop', 'phone'], platform: 'win32' }).win32, counts);
});

test('the baseline holds a section per platform of fingerprints with positive counts, and a note on how to lower it', () => {
  assert.match(baseline[NOTE], /--lower/);
  const platforms = Object.keys(baseline).filter((k) => k !== NOTE);
  assert.ok(platforms.includes('linux'), 'the baseline is seeded for linux, the platform the CI gate runs on');
  for (const platform of platforms) {
    const keys = Object.keys(baseline[platform]);
    assert.ok(keys.length > 0, `${platform} is seeded`);
    for (const k of keys) {
      const [kind, selector, cell, ...rest] = k.split('|');
      assert.ok(KINDS.includes(kind), `${platform} ${k}: kind is one of ${KINDS.join(', ')}`);
      assert.ok(selector && !/\d/.test(selector), `${platform} ${k}: the selector is normalised`);
      assert.ok(cell === undefined || (cell !== 'desktop' && Object.hasOwn(CELLS, cell)), `${platform} ${k}: names a known cell`);
      assert.deepEqual(rest, []);
      assert.ok(Number.isInteger(baseline[platform][k]) && baseline[platform][k] > 0, `${platform} ${k}: a positive count`);
    }
  }
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const baselineAt = (rev) => { try { return JSON.parse(git('show', `${rev}:${FILE}`)); } catch { return null; } };

test('the baseline never grows past its committed version', () => {
  assert.deepEqual(grew(baselineAt('HEAD'), baseline), [], `${FILE} only ever shrinks: fix the cut-off instead of adding it`);
});

test('the committed baseline never grows past its first parent, the base a pull request merges into', () => {
  assert.deepEqual(grew(baselineAt('HEAD^1'), baselineAt('HEAD')), [], `HEAD grew ${FILE} past HEAD^1: fix the cut-off instead of adding it`);
});

test('the cells are desktop 1440x900 in Chromium and phone 390x844 in WebKit', () => {
  assert.deepEqual(CELLS.desktop.viewport, { width: 1440, height: 900 });
  assert.equal(CELLS.desktop.engine, 'chromium');
  assert.deepEqual(CELLS.phone.viewport, { width: 390, height: 844 });
  assert.equal(CELLS.phone.engine, 'webkit');
  for (const j of JOURNEYS) for (const c of cellsOf(j)) assert.ok(Object.hasOwn(CELLS, c), `${j.name} walks a cell the sweep knows`);
});

test('every overlay names a route, a cell, a root and an opener, once', () => {
  const names = OVERLAYS.map((o) => o.name);
  assert.equal(new Set(names).size, names.length);
  for (const o of OVERLAYS) {
    assert.ok(Object.hasOwn(ROUTES, o.route), `${o.name}: route ${o.route}`);
    assert.ok(o.cells.length && o.cells.every((c) => Object.hasOwn(CELLS, c)), `${o.name}: cells`);
    assert.equal(typeof o.root, 'string');
    assert.equal(typeof o.act, 'function');
  }
});

test('the field editor tray is opened on both cells, so its Description placeholder is measured', () => {
  const trays = OVERLAYS.filter((o) => o.root === '#tray-back' && /field/.test(o.name));
  for (const cell of Object.keys(CELLS)) assert.ok(trays.some((o) => o.cells.includes(cell)), `a field tray opens on ${cell}`);
});
