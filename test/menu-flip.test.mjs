import test from 'node:test';
import assert from 'node:assert/strict';
import { liftFunction, APP } from './lib/source.mjs';

const menuSide = liftFunction('menuSide');

const DOC_DL = { anchorLeft: 1205, anchorRight: 1231, width: 178, boundsLeft: 0, boundsRight: 1280 };

test('a left-aligned panel that would spill past the right bound flips', () => {
  assert.equal(menuSide({ ...DOC_DL, prefer: 'left' }), 'right',
    'left placement ends at 1383, past the 1280 viewport');
});

test('the flip actually fits: the flipped span sits inside the bounds', () => {
  const side = menuSide({ ...DOC_DL, prefer: 'left' });
  const left = side === 'right' ? DOC_DL.anchorRight - DOC_DL.width : DOC_DL.anchorLeft;
  assert.ok(left >= DOC_DL.boundsLeft, `${left} is inside the left bound`);
  assert.ok(left + DOC_DL.width <= DOC_DL.boundsRight, `${left + DOC_DL.width} is inside the right bound`);
});

test('a panel with room to its right keeps the side its caller asked for', () => {
  assert.equal(menuSide({ anchorLeft: 40, anchorRight: 66, width: 178, boundsLeft: 0, boundsRight: 1280, prefer: 'left' }), 'left');
});

test("a right-aligned panel that fits stays right", () => {
  assert.equal(menuSide({ anchorLeft: 1150, anchorRight: 1176, width: 178, boundsLeft: 0, boundsRight: 1280, prefer: 'right' }), 'right');
});

test('a right-aligned panel that would spill past the LEFT bound flips too', () => {
  assert.equal(menuSide({ anchorLeft: 1020, anchorRight: 1046, width: 178, boundsLeft: 1000, boundsRight: 1280, prefer: 'right' }), 'left');
});

test('bounds are honoured, not just the viewport', () => {
  const peek = { boundsLeft: 900, boundsRight: 1280 };
  assert.equal(menuSide({ anchorLeft: 1180, anchorRight: 1206, width: 178, ...peek, prefer: 'left' }), 'right',
    'left placement would end at 1358, past the peek');
  assert.equal(menuSide({ anchorLeft: 920, anchorRight: 946, width: 178, ...peek, prefer: 'left' }), 'left');
});

test('a panel wider than its bounds keeps its caller\'s side rather than picking at random', () => {
  assert.equal(menuSide({ anchorLeft: 100, anchorRight: 126, width: 400, boundsLeft: 90, boundsRight: 300, prefer: 'left' }), 'left');
  assert.equal(menuSide({ anchorLeft: 100, anchorRight: 126, width: 400, boundsLeft: 90, boundsRight: 300, prefer: 'right' }), 'right');
});

test('the decision leaves a small gutter rather than touching the bound', () => {
  const flush = { anchorLeft: 1100, anchorRight: 1126, width: 180, boundsLeft: 0, boundsRight: 1280 };
  assert.equal(menuSide({ ...flush, prefer: 'left' }), 'right', '1100 + 180 = 1280 is flush, and flush is not fit');
});

test('dotsMenu places the panel every time it opens, not once when it is built', () => {
  const src = APP;
  const at = src.indexOf('function dotsMenu(');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(body, /menu\.classList\.remove\('hidden'\)[\s\S]{0,200}place\(\)/,
    'the placement runs inside the open, after the panel is visible and measurable');
  assert.match(body, /menuSide\(/, 'dotsMenu asks menuSide which way to hang');
  assert.match(body, /classList\.toggle\('dl-menu-right'/,
    'the side is set both ways — a menu that flipped once must be able to flip back');
});

test('menuBounds reads the nearest clipping ancestor, falling back to the viewport', () => {
  const bounds = liftFunction('menuBounds', { getComputedStyle: () => ({ overflowX: 'visible' }) });
  assert.equal(typeof bounds, 'function');
  const doc = { documentElement: { clientWidth: 1280 } };
  const fake = liftFunction('menuBounds', {
    getComputedStyle: () => ({ overflowX: 'visible' }),
    document: { ...doc, body: { tag: 'body' } },
  });
  assert.deepEqual(fake({ parentElement: null }), { left: 0, right: 1280 },
    'no clipping ancestor: the viewport is the bound');
});
