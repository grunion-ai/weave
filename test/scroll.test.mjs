/* Programmatic scrolling (Issue #69).

   `Element.scrollIntoView()` is defined to scroll EVERY scrollable ancestor of
   its target. A weave document sits in a scrolling body, often inside a docked
   panel, so jumping to one heading used to reset scroll positions the reader
   never asked about — Kyle saw exactly that on the outline rail. Every
   programmatic scroll now names the one box that may move.

   The arithmetic — which box, and where its scrollTop lands — is pure and
   lives in public/editor-lib.js; it is tested here. The live behaviour (one
   box moves, the others hold) is in test/editor-phase4-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, fnBody } from './lib/source.mjs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
// Comments name the method they replaced; only the code may still call it.
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ---------- scrollBoxIndex: which single box moves ---------- */

const box = (overflowY, scrollHeight, clientHeight) => ({ overflowY, scrollHeight, clientHeight });

test('the box that scrolls is the nearest ancestor that can and does', () => {
  const chain = [
    box('visible', 400, 400), // the heading's own wrapper: no overflow at all
    box('auto', 4000, 600), // the docked panel: this is the one
    box('auto', 9000, 800), // the page behind it: must not be picked
  ];
  assert.equal(LIB.scrollBoxIndex(chain), 1);
});

test('a box that allows overflow but has nothing to scroll is not the box', () => {
  assert.equal(LIB.scrollBoxIndex([box('auto', 600, 600), box('scroll', 4000, 600)]), 1);
});

test('a box that clips instead of scrolling is not the box', () => {
  assert.equal(LIB.scrollBoxIndex([box('hidden', 4000, 600), box('overlay', 4000, 600)]), 1);
});

test('nothing in the chain scrolls, so the page does', () => {
  assert.equal(LIB.scrollBoxIndex([box('visible', 400, 400), box('hidden', 4000, 600)]), -1);
  assert.equal(LIB.scrollBoxIndex([]), -1);
  assert.equal(LIB.scrollBoxIndex(undefined), -1);
});

/* ---------- scrollTopFor: where that box lands ----------
   One shared coordinate space (viewport rects do fine): the box shows
   [viewTop, viewTop + viewHeight] and the target sits at [targetTop, +height]. */

const G = (over = {}) => ({
  scrollTop: 500, scrollHeight: 4000, viewTop: 100, viewHeight: 600,
  targetTop: 900, targetHeight: 40, ...over,
});

test('block start puts the target at the top of the box', () => {
  // 800px below the box's own top, so the box has to travel 800 further.
  assert.equal(LIB.scrollTopFor(G()), 1300);
});

test('padding holds the target clear of whatever covers the top edge', () => {
  assert.equal(LIB.scrollTopFor(G({ padding: 80 })), 1220);
});

test('the landing is clamped to the box, never past its ends', () => {
  assert.equal(LIB.scrollTopFor(G({ targetTop: -4000 })), 0, 'never above the start');
  assert.equal(LIB.scrollTopFor(G({ targetTop: 40000 })), 3400, 'never past scrollHeight - viewHeight');
});

test('nearest leaves a target that is already in view exactly where it is', () => {
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 300 })), 500);
});

test('nearest brings a target above the box down to its top edge', () => {
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 20 })), 420);
});

test('nearest brings a target below the box up to its bottom edge', () => {
  // bottom of the target (900 + 40) minus bottom of the box (100 + 600) = 240.
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest' })), 740);
});

test('nearest respects padding at the top edge', () => {
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 150, padding: 80 })), 470);
});

test('nearest respects a cover at the bottom edge (the sticky + New foot, Feature #196)', () => {
  // The target's bottom (940) must clear the box's bottom (700) minus the 34px foot: 274 more.
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', bottom: 34 })), 774);
  // Already clear of the foot: nothing moves.
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 600, bottom: 34 })), 500);
  // Inside the box but under the foot: moves just enough.
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 650, bottom: 34 })), 524);
});

/* ---------- wiring: every site goes through the one helper ---------- */

test('nothing in the app calls scrollIntoView any more', () => {
  assert.doesNotMatch(CODE, /\.scrollIntoView\(/,
    'scrollIntoView scrolls every scrollable ancestor — use scrollTargetIntoView');
});

test('the four programmatic scrolls all go through scrollTargetIntoView', () => {
  const calls = CODE.match(/scrollTargetIntoView\(/g) ?? [];
  assert.equal(calls.length, 5, 'one definition and the four call sites');
  assert.match(CODE, /doc-rail-dash[^]{0,500}scrollTargetIntoView\(heads\[i\]/, 'the outline rail');
  assert.match(CODE, /scrollTargetIntoView\(host\.querySelector\('\.vditor-hint--current'\)/,
    "the editor's slash menu");
  assert.match(CODE, /scrollTargetIntoView\(rowEls\[sel\]/, 'the search palette');
  assert.match(CODE, /scrollTargetIntoView\(row,/, 'a new grid row taking focus');
});

test('the helper moves the resolved box and nothing else', () => {
  const body = fnBody('scrollTargetIntoView');
  assert.match(body, /scrollBoxOf\(/, 'it resolves the one box explicitly');
  assert.match(body, /scrollTopFor\(/, 'and asks the pure helper where to land');
  assert.match(body, /\(box \?\? window\)\.scrollTo\(/,
    'it scrolls that box — or the page — never the ancestor chain');
  assert.match(fnBody('scrollBoxOf'), /scrollBoxIndex\(/, 'the box comes from the pure walk');
});

test('the scroll animates unless the reader or the tab says otherwise', () => {
  assert.match(fnBody('scrollTargetIntoView'), /smoothScrollOk\(\)\s*\?\s*'smooth'/,
    'animated by default — Kyle overruled the jump');
  const ok = CODE.slice(CODE.indexOf('const smoothScrollOk'), CODE.indexOf('function scrollBoxOf'));
  assert.match(ok, /prefers-reduced-motion/, 'instant when the reader asked for less motion');
  assert.match(ok, /document\.hidden/,
    'and instant in a hidden tab, which never runs the frames the animation rides on');
});

test('keepScroll restores every box that was scrolled, not one hard-coded scroller', () => {
  const body = fnBody('keepScroll');
  assert.match(body, /querySelectorAll\('\*'\)/, 'it looks at every box on the page');
  assert.match(body, /scrollTop\s*\|\|\s*\w+\.scrollLeft/, 'a box resting at the origin has nothing to restore');
  assert.match(body, /isConnected/, 'a box the redraw replaced cannot be restored on the old node');
  assert.match(body, /window\.scrollTo\(x, y\)/, 'and the page itself still holds its place');
});
