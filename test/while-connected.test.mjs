import test from 'node:test';
import assert from 'node:assert/strict';
import { read, fnBody, liftFunction } from './lib/source.mjs';

const APP_JS = read('public/app.js');

const fakeWindow = () => {
  const fns = new Map();
  return {
    addEventListener: (type, fn, capture = false) => fns.set(fn, `${type}|${capture}`),
    removeEventListener: (type, fn, capture = false) => { if (fns.get(fn) === `${type}|${capture}`) fns.delete(fn); },
    fire: (type, e) => { for (const [fn, at] of [...fns]) if (at.startsWith(`${type}|`)) fn(e); },
    count: () => fns.size,
  };
};

test('whileConnected forwards events while its node is in the page, then unhooks itself (Issue #663)', () => {
  const win = fakeWindow();
  const whileConnected = liftFunction('whileConnected', { addEventListener: win.addEventListener, removeEventListener: win.removeEventListener }, APP_JS);
  const node = { isConnected: true };
  const seen = [];
  whileConnected(node, 'keydown', (e) => seen.push(e.key));
  assert.equal(win.count(), 1);
  win.fire('keydown', { key: 'a' });
  node.isConnected = false;
  win.fire('keydown', { key: 'Escape' });
  assert.deepEqual(seen, ['a'], 'a key pressed after the node left the page never reaches the handler');
  assert.equal(win.count(), 0, 'and the listener is gone');
});

test('whileConnected returns an off that removes the listener in the same phase it was added (Issue #663)', () => {
  const win = fakeWindow();
  const whileConnected = liftFunction('whileConnected', { addEventListener: win.addEventListener, removeEventListener: win.removeEventListener }, APP_JS);
  const node = { isConnected: true };
  let hits = 0;
  const off = whileConnected(node, 'keydown', () => { hits++; off(); }, true);
  win.fire('keydown', { key: 'Escape' });
  win.fire('keydown', { key: 'Escape' });
  assert.equal(hits, 1, 'a handler that calls off fires once');
  assert.equal(win.count(), 0, 'a capture listener is removed with capture');
});

test('no overlay hand-rolls a self-removing window listener; each goes through whileConnected (Issue #663, Feature #177)', () => {
  assert.doesNotMatch(APP_JS, /isConnected\) return removeEventListener\(/, 'the isConnected-then-unhook idiom lives in whileConnected only');
  for (const fn of ['holdPage', 'modal', 'tray', 'expandDocument', 'fullscreenViewer', 'onboard', 'openBugPanel']) {
    assert.match(fnBody(fn, APP_JS), /whileConnected\(/, `${fn} hooks its window listener through whileConnected`);
  }
});
