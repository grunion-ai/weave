import test from 'node:test';
import assert from 'node:assert/strict';
import { read, fnBody, liftFunction } from './lib/source.mjs';

const APP_JS = read('public/app.js');
const node = (name) => {
  const on = {};
  const n = { name, isConnected: false, focused: false, on, addEventListener: (type, fn) => { on[type] = fn; }, focus() { n.focused = true; } };
  n.replaceWith = (other) => { n.isConnected = false; other.isConnected = true; };
  return n;
};

test('swapToEdit swaps the display for its input on click and back on blur (Feature #177)', () => {
  const swapToEdit = liftFunction('swapToEdit', {}, APP_JS);
  const display = node('display');
  const input = node('input');
  display.isConnected = true;
  let stopped = false;
  assert.equal(swapToEdit(display, input), display);
  display.on.click({ stopPropagation: () => { stopped = true; } });
  assert.ok(stopped && input.isConnected && input.focused && !display.isConnected, 'a click opens the input and keeps the click off the row');
  input.on.blur();
  assert.ok(display.isConnected && !input.isConnected, 'leaving the input puts the display back');
  input.on.blur();
  assert.ok(display.isConnected, 'a blur on a detached input does nothing');
});

test('a number cell swaps its graphic and its dressed value through swapToEdit (Feature #177)', () => {
  const body = fnBody('editorFor', APP_JS);
  assert.equal((body.match(/swapToEdit\(/g) ?? []).length, 2, 'the graphic and the dressed number');
  assert.doesNotMatch(body, /input\.addEventListener\('blur', \(\) => \{ if \(input\.isConnected\) input\.replaceWith/, 'no hand-rolled swap back');
});
