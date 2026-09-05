/* Which side a ⋮ panel hangs off, decided on open (Issue #133).

   The defect: the document section's downloads menu opened past the right edge
   of the page and painted mostly off-screen — measured live at a 1280px
   viewport, a 178px panel at left 1205 / right 1383, so the reader saw a
   sliver of "…ownloa" and could not reach a single item.

   The cause was structural rather than local. dotsMenu took `align` as a
   constructor option, so the side was chosen where the menu was WRITTEN: only
   the callers that happened to pass 'right' flipped, and the same ⋮ that sits
   comfortably left-aligned in a toolbar spills off the page in a document
   head. Patching the one caller would have left the next one to find.

   menuSide() is the arithmetic, lifted out of app.js and exercised here: given
   the anchor, the panel width and the bounds it has to live inside, it names
   the side. The DOM half — reading the bounds off the nearest clipping
   ancestor and toggling the class — is measured in a real browser by
   test/menu-flip-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { liftFunction, APP } from './lib/source.mjs';

const menuSide = liftFunction('menuSide');

/* The live measurement from the Issue, as numbers: the doc ⋮ sits at the
   right end of the section head, the panel is 178px, the viewport 1280. */
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

/* The table and space menus pass align:'right' because they sit at the end of
   a toolbar. That preference has to survive: a menu that fits where its caller
   put it is never moved. */
test("a right-aligned panel that fits stays right", () => {
  assert.equal(menuSide({ anchorLeft: 1150, anchorRight: 1176, width: 178, boundsLeft: 0, boundsRight: 1280, prefer: 'right' }), 'right');
});

test('a right-aligned panel that would spill past the LEFT bound flips too', () => {
  // The same ⋮ inside a narrow side peek whose left edge is at 1000.
  assert.equal(menuSide({ anchorLeft: 1020, anchorRight: 1046, width: 178, boundsLeft: 1000, boundsRight: 1280, prefer: 'right' }), 'left');
});

/* The side peek is the case the Issue names second: the panel clips against
   the peek's edge, not the window's, so the bounds are the container's. */
test('bounds are honoured, not just the viewport', () => {
  const peek = { boundsLeft: 900, boundsRight: 1280 };
  assert.equal(menuSide({ anchorLeft: 1180, anchorRight: 1206, width: 178, ...peek, prefer: 'left' }), 'right',
    'left placement would end at 1358, past the peek');
  assert.equal(menuSide({ anchorLeft: 920, anchorRight: 946, width: 178, ...peek, prefer: 'left' }), 'left');
});

test('a panel wider than its bounds keeps its caller\'s side rather than picking at random', () => {
  // Neither side fits; moving it would trade one clipped edge for another.
  assert.equal(menuSide({ anchorLeft: 100, anchorRight: 126, width: 400, boundsLeft: 90, boundsRight: 300, prefer: 'left' }), 'left');
  assert.equal(menuSide({ anchorLeft: 100, anchorRight: 126, width: 400, boundsLeft: 90, boundsRight: 300, prefer: 'right' }), 'right');
});

/* A panel flush against the bound is not clipped; only one past it is. The
   pad keeps a hair of gutter so a 1px rounding does not read as a fit. */
test('the decision leaves a small gutter rather than touching the bound', () => {
  const flush = { anchorLeft: 1100, anchorRight: 1126, width: 180, boundsLeft: 0, boundsRight: 1280 };
  assert.equal(menuSide({ ...flush, prefer: 'left' }), 'right', '1100 + 180 = 1280 is flush, and flush is not fit');
});

/* ---------- the wiring, in source ---------- */

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
