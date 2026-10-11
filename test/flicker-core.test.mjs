import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint, confirm, frameFlashes, diffRatio, regressed, evidenceFrames, GATED, answering, ANSWER_FRAMES } from './lib/flicker.mjs';
import { CELLS, JOURNEYS, cellsOf } from './lib/journeys.mjs';
import { PHONE } from './lib/browser.mjs';

const ev = (kind, sel, extra = {}) => ({ kind, sel, ms: 40, ...extra });

test('a fingerprint names the journey, the kind and the element', () => {
  assert.equal(fingerprint('open-table', ev('transient', 'main > div.wv-skel')), 'open-table|transient|main > div.wv-skel');
});

test('a fingerprint keeps the last two steps of the selector, so a state class up the tree does not split one defect', () => {
  assert.equal(fingerprint('j', ev('revert', 'td.clipped > div.wv-cb > span.ms-box')), 'j|revert|div.wv-cb > span.ms-box');
  assert.equal(fingerprint('j', ev('revert', 'td > div.wv-cb > span.ms-box')), 'j|revert|div.wv-cb > span.ms-box');
});

test('a fingerprint names the matrix cell it was seen in, and a desktop one keeps its three-part form (Issue #732)', () => {
  assert.equal(fingerprint('phone-swipe', ev('cut', 'tr.entity-row > td.swipe-cell', { cell: 'phone' })), 'phone-swipe|cut|tr.entity-row > td.swipe-cell|phone');
  assert.equal(fingerprint('open-table', ev('transient', 'main > div.wv-skel', { cell: 'desktop' })), 'open-table|transient|main > div.wv-skel');
  assert.equal(fingerprint('open-table', ev('transient', 'main > div.wv-skel')), 'open-table|transient|main > div.wv-skel', 'an event with no cell is the desktop cell');
});

test('the same flicker seen in two cells is two findings, each naming its cell (Issue #732)', () => {
  const both = [ev('transient', 'div.a'), ev('transient', 'div.a', { cell: 'phone' })];
  const got = confirm([{ j: both }, { j: both }, { j: [] }]);
  assert.deepEqual(got.map((f) => [f.fp, f.cell]), [['j|transient|div.a', 'desktop'], ['j|transient|div.a|phone', 'phone']]);
});

test('regressed holds a fixed fingerprint to the cell it was fixed in (Issue #732)', () => {
  const fixed = { 'open-table|transient|div.a': { issue: 1 }, 'phone-swipe|cut|td.swipe-cell|phone': { issue: 2 } };
  assert.deepEqual(regressed({ 'open-table': [ev('transient', 'div.a')] }, fixed), ['open-table|transient|div.a'], 'an old desktop entry still matches the desktop cell');
  assert.deepEqual(regressed({ 'open-table': [ev('transient', 'div.a', { cell: 'phone' })] }, fixed), [], 'a desktop fix says nothing about the phone');
  assert.deepEqual(regressed({ 'phone-swipe': [ev('cut', 'td.swipe-cell', { cell: 'phone' })] }, fixed), ['phone-swipe|cut|td.swipe-cell|phone']);
});

test('the matrix is desktop Chromium at 1400x900 and the iPhone profile in WebKit (Issue #732)', () => {
  assert.deepEqual(CELLS.desktop, { engine: 'chromium', viewport: { width: 1400, height: 900 }, hasTouch: false, isMobile: false });
  assert.deepEqual(CELLS.phone, { engine: 'webkit', device: PHONE });
});

test('every journey walks in cells the matrix has, and the phone gets its own journeys (Issue #732)', () => {
  for (const j of JOURNEYS) for (const c of cellsOf(j)) assert.ok(Object.hasOwn(CELLS, c), `${j.name} names cell ${c}`);
  assert.deepEqual(cellsOf({ name: 'x' }), ['desktop'], 'a journey that names no cells walks the desktop only');
  const phone = JOURNEYS.filter((j) => cellsOf(j).includes('phone')).map((j) => j.name);
  for (const name of ['phone-search', 'phone-menu', 'phone-table-sheet', 'phone-picker', 'phone-open-row']) assert.ok(phone.includes(name), `${name} walks the phone`);
  assert.ok(phone.includes('load-home') && phone.includes('open-table'), 'desktop journeys that make sense on a phone walk it too');
});

test('confirm keeps what two runs of three saw, and drops what one run saw', () => {
  const runs = [
    { 'open-table': [ev('transient', 'div.a', { ms: 30 }), ev('shift', 'div.b')] },
    { 'open-table': [ev('transient', 'div.a', { ms: 70 })] },
    { 'open-table': [ev('blank', 'tbody')] },
  ];
  const got = confirm(runs);
  assert.deepEqual(got.map((f) => f.fp), ['open-table|transient|div.a']);
  assert.equal(got[0].runs, 2, 'it says how many runs saw it');
  assert.equal(got[0].ms, 70, 'and the longest it lasted');
  assert.equal(got[0].journey, 'open-table');
});

test('one run that sees a thing five times still counts as one run', () => {
  const many = Array.from({ length: 5 }, () => ev('revert', 'tr.entity-row'));
  const got = confirm([{ j: many }, { j: [] }, { j: [] }]);
  assert.deepEqual(got, []);
});

test('confirm takes the threshold it is given', () => {
  const got = confirm([{ j: [ev('blank', 'x')] }], { min: 1 });
  assert.equal(got.length, 1);
});

const solid = (c) => ({ width: 4, height: 4, at: () => c });
const W = [255, 255, 255], K = [0, 0, 0];

test('diffRatio is the share of sampled pixels that differ', () => {
  assert.equal(diffRatio(solid(W), solid(W)), 0);
  assert.equal(diffRatio(solid(W), solid(K)), 1);
  const half = { width: 4, height: 4, at: (x) => (x < 2 ? W : K) };
  assert.equal(diffRatio(solid(W), half), 0.5);
});

test('A, B, A with B up for a beat is a flash; B that stays is a change', () => {
  const f = (t, px) => ({ t, px });
  const flashes = frameFlashes([f(0, solid(W)), f(100, solid(K)), f(140, solid(W))]);
  assert.equal(flashes.length, 1);
  assert.equal(flashes[0].ms, 40);
  assert.equal(flashes[0].at, 100);
  assert.deepEqual(frameFlashes([f(0, solid(W)), f(100, solid(K)), f(900, solid(W))]), [], 'a caret blink is not a flash');
  assert.deepEqual(frameFlashes([f(0, solid(W)), f(100, solid(K)), f(140, solid(K))]), [], 'arriving somewhere new is not a flash');
});

test('the gate only reads the kinds a loaded machine cannot invent', () => {
  assert.ok(!GATED.includes('jank'), 'a long frame under load average 80 says nothing about the change');
  assert.ok(!GATED.includes('frame'), 'the screencast is the sweep\'s, not the gate\'s');
  for (const k of ['transient', 'blank', 'revert', 'shift', 'cut']) assert.ok(GATED.includes(k), k);
});

test('regressed names a fixed fingerprint that came back, and nothing else', () => {
  const fixed = { 'open-table|transient|div.a': { issue: 1 } };
  const seen = { 'open-table': [ev('transient', 'div.a'), ev('transient', 'div.new'), ev('jank', 'div.a')] };
  assert.deepEqual(regressed(seen, fixed), ['open-table|transient|div.a']);
  assert.deepEqual(regressed({ 'open-table': [ev('blank', 'div.a')] }, fixed), []);
});

test('every fixed fingerprint names the Issue that fixed it', () => {
  const fixed = JSON.parse(readFileSync(new URL('./flicker-fixed.json', import.meta.url), 'utf8'));
  for (const [fp, row] of Object.entries(fixed)) {
    if (fp.startsWith('_')) continue;
    assert.match(fp, /^[a-z-]+\|(transient|blank|revert|shift|cut)\|[^|]+(\|(phone))?$/, `${fp} is a gated fingerprint`);
    assert.ok(Number.isInteger(row.issue) && row.issue > 0, `${fp} names its Issue`);
  }
});

test('evidence: a DOM flicker gets the frames around its window; a frame flash gets A, B, A itself', () => {
  const fr = [0, 100, 140, 200, 300].map((t) => ({ t }));
  assert.deepEqual(evidenceFrames(fr, { kind: 'transient', at: 190, ms: 70 }).map((f) => f.t), [100, 140, 200]);
  assert.deepEqual(evidenceFrames(fr, { kind: 'frame', i: 2, at: 140, ms: 60 }).map((f) => f.t), [100, 140, 200]);
  assert.deepEqual(evidenceFrames([], { kind: 'blank', at: 5, ms: 1 }), []);
});

test('a frame flash inside the window of the reader\'s own input is not a flash (Issue #638)', () => {
  const f = (t, px) => ({ t, px });
  const aba = [f(1000, solid(W)), f(1016, solid(W)), f(1032, solid(W)), f(1048, solid(W)), f(1064, solid(K)), f(1080, solid(W))];
  assert.equal(frameFlashes(aba).length, 1, 'with no input log the frame rule is unchanged');
  assert.deepEqual(frameFlashes(aba, { inputs: [1050] }), [], 'the reader pressed a key in the frame before the flash');
  assert.equal(frameFlashes(aba, { inputs: [990] }).length, 1, 'four frames were painted before the flash, so it is not what they answered');
  assert.equal(frameFlashes(aba, { inputs: [990, 1200] }).length, 1, 'an input after the frame cannot have caused it');
  assert.deepEqual(frameFlashes(aba, { inputs: [990, 1040, 1200] }), [], 'the newest input at or before the frame is the one that counts');
});

test('a re-window 80 ms after the scroll is still the reader\'s own scroll while the scroll is settling (Issue #712)', () => {
  assert.equal(answering(1080, { input: 1000, frames: [1000, 1101] }), true, 'one 100 ms frame carried both the scroll and the re-window');
  assert.equal(answering(1080, { input: 1000, frames: [1000, 1017, 1034, 1051, 1068] }), false, 'three frames were painted first, so the reader saw the jump');
});

test('the input window is three painted frames, so a busy host widens it in milliseconds and nothing else (Issue #712)', () => {
  assert.equal(ANSWER_FRAMES, 3);
  assert.equal(answering(1070, { input: 1000, frames: [1000, 1017, 1034, 1051, 1068] }), false, 'at 60 Hz the window closes inside 70 ms');
  assert.equal(answering(1270, { input: 1000, frames: [1000, 1100, 1200, 1300] }), true, 'at 10 Hz the same three frames are still open 270 ms later');
  assert.equal(answering(1270, { input: 1000, frames: [] }), true, 'a page that painted nothing in between has not answered yet');
  assert.equal(answering(1270, { input: 1000, frames: [1000, 1050, 1100, 1150, 1200] }), false, 'the budget is a number of frames, and three painted at 20 Hz spend it');
});
