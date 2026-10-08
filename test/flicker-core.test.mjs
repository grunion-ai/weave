import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint, confirm, frameFlashes, diffRatio, regressed, evidenceFrames, GATED } from './lib/flicker.mjs';

const ev = (kind, sel, extra = {}) => ({ kind, sel, ms: 40, ...extra });

test('a fingerprint names the journey, the kind and the element', () => {
  assert.equal(fingerprint('open-table', ev('transient', 'main > div.wv-skel')), 'open-table|transient|main > div.wv-skel');
});

test('a fingerprint keeps the last two steps of the selector, so a state class up the tree does not split one defect', () => {
  assert.equal(fingerprint('j', ev('revert', 'td.clipped > div.wv-cb > span.ms-box')), 'j|revert|div.wv-cb > span.ms-box');
  assert.equal(fingerprint('j', ev('revert', 'td > div.wv-cb > span.ms-box')), 'j|revert|div.wv-cb > span.ms-box');
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
  for (const k of ['transient', 'blank', 'revert', 'shift']) assert.ok(GATED.includes(k), k);
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
    assert.match(fp, /^[a-z-]+\|(transient|blank|revert|shift)\|.+/, `${fp} is a gated fingerprint`);
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
  const aba = [f(1000, solid(W)), f(1100, solid(K)), f(1140, solid(W))];
  assert.equal(frameFlashes(aba).length, 1, 'with no input log the frame rule is unchanged');
  assert.deepEqual(frameFlashes(aba, { inputs: [1085] }), [], 'the reader pressed a key 15 ms before the frame');
  assert.equal(frameFlashes(aba, { inputs: [900] }).length, 1, 'an input 200 ms earlier is not what the frame answers');
  assert.equal(frameFlashes(aba, { inputs: [900, 1200] }).length, 1, 'an input after the frame cannot have caused it');
  assert.deepEqual(frameFlashes(aba, { inputs: [900, 1060, 1200] }), [], 'the newest input at or before the frame is the one that counts');
});
