import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CELLS, KINDS, NOTE, PLATFORM, TOLERANCE, cellOf, collide, fingerprint, overlapOf, pageWide, pastEdge, sectionOf, tally, verdict } from './lib/collision.mjs';
import { PROBES, held, walked } from './lib/states.mjs';

const holds = JSON.parse(readFileSync(new URL('./collision-held.json', import.meta.url), 'utf8'));
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const atom = (layer, ...rects) => ({ layer, rects });
const f = (kind, selector, extra = {}) => ({ kind, selector, text: 'x', px: 9, ...extra });

test('two boxes that intersect report the smaller side of the overlap', () => {
  assert.equal(overlapOf(box(0, 0, 100, 20), box(60, 4, 160, 24)), 16);
  assert.equal(overlapOf(box(0, 0, 100, 40), box(40, 10, 60, 30)), 20);
});

test('boxes that only touch, or meet inside the tolerance, are not an overlap', () => {
  assert.equal(overlapOf(box(0, 0, 100, 20), box(100, 0, 200, 20)), 0);
  assert.equal(overlapOf(box(0, 0, 100, 20), box(99, 0, 200, 20)), 0, 'a 1px seam is a border, not an overlap');
  assert.equal(overlapOf(box(0, 0, 100, 20), box(50, 19, 150, 40)), 0, 'a 1px vertical bleed is not an overlap');
  assert.equal(TOLERANCE, 2);
});

test('two atoms in one stacking layer that intersect are a finding', () => {
  assert.equal(collide(atom(0, box(0, 0, 100, 20)), atom(0, box(60, 4, 160, 24))), 16);
});

test('the same two atoms in different stacking layers are intentional, never a finding', () => {
  assert.equal(collide(atom(0, box(0, 0, 100, 20)), atom(3, box(60, 4, 160, 24))), 0);
});

test('an atom is judged by every line it draws, and the worst line wins', () => {
  const two = atom(0, box(0, 0, 100, 20), box(0, 20, 60, 40));
  assert.equal(collide(two, atom(0, box(10, 24, 50, 36))), 12);
  assert.equal(collide(two, atom(0, box(70, 24, 90, 36))), 0, 'the second line is shorter, so nothing meets it there');
});

test('an element past the viewport edge is a finding, and one inside it is not', () => {
  const view = { width: 390, height: 844 };
  assert.equal(pastEdge(box(300, 10, 430, 30), view), 40);
  assert.equal(pastEdge(box(-24, 10, 100, 30), view), 24);
  assert.equal(pastEdge(box(10, 10, 380, 30), view), 0);
  assert.equal(pastEdge(box(10, 10, 391, 30), view), 0, 'a pixel of rounding is not a control off the screen');
});

test('a page wider than the viewport is a finding, measured in pixels', () => {
  assert.equal(pageWide(520, { width: 390 }), 130);
  assert.equal(pageWide(391, { width: 390 }), 0);
  assert.equal(pageWide(390, { width: 390 }), 0);
});

test('a fingerprint is the kind, both selectors and the cell, with every number folded', () => {
  assert.equal(fingerprint(f('overlap', 'div.bar > button.c12', { with: 'span.chip-7' })), 'overlap|div.bar > button.c#~span.chip-#');
  assert.equal(fingerprint(f('protrusion', 'button.act'), 'phone'), 'protrusion|button.act|phone');
  assert.equal(fingerprint(f('page-wide', 'html'), 'phone'), 'page-wide|html|phone');
  assert.equal(fingerprint(f('overlap', 'div#e-0b6c3f2a-1d2e-4f50-9a8b-7c6d5e4f3a21 > span', { with: 'b.x' })), 'overlap|div#e-# > span~b.x');
  assert.equal(cellOf('protrusion|button.act|phone'), 'phone');
  assert.equal(cellOf('protrusion|button.act'), 'desktop');
});

test('tally counts instances per fingerprint and cell, in key order', () => {
  const got = tally([f('overlap', 'span.a', { with: 'span.b' }), f('overlap', 'span.a', { with: 'span.b' }), f('protrusion', 'button.c', { cell: 'phone' })]);
  assert.deepEqual(got, { 'overlap|span.a~span.b': 2, 'protrusion|button.c|phone': 1 });
  assert.deepEqual(Object.keys(got), Object.keys(got).toSorted());
});

test('zero tolerance: a fingerprint no hold names fails, however few times it was measured', () => {
  const { unheld, gone } = verdict({ 'overlap|span.a~span.b': 1 }, { [NOTE]: 'doc' });
  assert.deepEqual(unheld, [{ fp: 'overlap|span.a~span.b', seen: 1 }]);
  assert.deepEqual(gone, []);
});

test('a held fingerprint passes, and one that no longer reproduces fails until its hold is dropped', () => {
  const file = { [NOTE]: 'doc', 'overlap|span.a~span.b': [1403] };
  assert.deepEqual(verdict({ 'overlap|span.a~span.b': 3 }, file), { unheld: [], gone: [] }, 'a hold is not a count ceiling');
  assert.deepEqual(verdict({}, file).gone, [{ fp: 'overlap|span.a~span.b', hold: [1403] }]);
});

test('verdict judges only the cells it is told were walked', () => {
  const seen = { 'protrusion|button.a|phone': 1 };
  assert.deepEqual(verdict(seen, {}, { cells: ['desktop'] }), { unheld: [], gone: [] });
  assert.deepEqual(verdict(seen, {}, { cells: ['phone'] }).unheld, [{ fp: 'protrusion|button.a|phone', seen: 1 }]);
  assert.deepEqual(verdict({}, { 'protrusion|button.a|phone': [1] }, { cells: ['desktop'] }).gone, [], 'a phone hold is not judged by a desktop run');
});

test('sectionOf reads one platform and treats a missing platform as no holds at all', () => {
  const file = { [NOTE]: 'doc', linux: { 'overlap|span.a~span.b': [1] } };
  assert.deepEqual(sectionOf(file, 'linux'), { 'overlap|span.a~span.b': [1] });
  assert.deepEqual(sectionOf(file, 'win32'), {});
  assert.equal(PLATFORM, process.platform);
});

test('the holds file carries a section per platform, and every hold names its Issue rows', () => {
  assert.match(holds[NOTE], /collision-sweep/);
  for (const platform of Object.keys(holds).filter((k) => k !== NOTE)) {
    for (const [fp, rows] of Object.entries(holds[platform])) {
      const [kind, selector, cell, ...rest] = fp.split('|');
      assert.ok(KINDS.includes(kind), `${platform} ${fp}: kind is one of ${KINDS.join(', ')}`);
      assert.ok(selector && !/\d/.test(selector), `${platform} ${fp}: the selector is normalised`);
      assert.ok(cell === undefined || (cell !== 'desktop' && Object.hasOwn(CELLS, cell)), `${platform} ${fp}: names a known cell`);
      assert.deepEqual(rest, []);
      assert.ok(Array.isArray(rows) && rows.length && rows.every((n) => Number.isInteger(n) && n > 0), `${platform} ${fp}: names the Issue rows that track it`);
    }
  }
});

test('the collision probe walks the same states, cells and seed as the cut-off probe', () => {
  assert.deepEqual(PROBES.collision, PROBES.cutoff);
  assert.ok(walked('collision').length >= 80, `the gate walks the state catalog (${walked('collision').length} entries)`);
  for (const p of held('collision')) assert.ok(p.hold.length, `${p.state.name}: a held state names its Issue rows`);
});
