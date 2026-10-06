import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, fnBody } from './lib/source.mjs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const box = (overflowY, scrollHeight, clientHeight) => ({ overflowY, scrollHeight, clientHeight });

test('the box that scrolls is the nearest ancestor that can and does', () => {
  const chain = [
    box('visible', 400, 400),
    box('auto', 4000, 600),
    box('auto', 9000, 800),
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

const G = (over = {}) => ({
  scrollTop: 500, scrollHeight: 4000, viewTop: 100, viewHeight: 600,
  targetTop: 900, targetHeight: 40, ...over,
});

test('block start puts the target at the top of the box', () => {
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
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest' })), 740);
});

test('nearest respects padding at the top edge', () => {
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 150, padding: 80 })), 470);
});

test('nearest respects a cover at the bottom edge (the sticky + New foot, Feature #196)', () => {
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', bottom: 34 })), 774);
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 600, bottom: 34 })), 500);
  assert.equal(LIB.scrollTopFor(G({ block: 'nearest', targetTop: 650, bottom: 34 })), 524);
});

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
  assert.match(body, /window\.scrollTo\(\{ left: x, top: y, behavior: 'instant' \}\)/, 'and the page itself still holds its place — instantly, a restore is not a scroll the reader asked for (Issue #271)');
  assert.match(body, /b\.el\.scrollTo\(\{ top: b\.top, left: b\.left, behavior: 'instant' \}\)/, 'every box the same way');
});
