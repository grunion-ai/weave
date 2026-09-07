/* A url cell is a link at rest (Handbook: "a string the grid renders as a
   link, opening in a new tab"). Until 2026-09-07 it drew the same text box
   as a text field: a click placed a caret and nothing opened.

   The fix is the #97 costume: the cell wears a real <a target="_blank"
   rel="noopener"> at rest, and an explicit gesture — the pencil, a
   double-click, Return on the focused cell — swaps the input in. urlParts()
   is the pure half; the browser suite (url-cell-browser.test.mjs) is the
   gesture half. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const HANDBOOK = readFileSync(new URL('../src/handbook.js', import.meta.url), 'utf8');

test('an http(s) value splits into the href, the host and the rest', () => {
  assert.deepEqual(LIB.urlParts('https://the.fibery.io/@public/api-docs#entities'),
    { href: 'https://the.fibery.io/@public/api-docs#entities', host: 'the.fibery.io', rest: '/@public/api-docs#entities' });
  assert.deepEqual(LIB.urlParts('http://localhost:4400/?to=/x'),
    { href: 'http://localhost:4400/?to=/x', host: 'localhost:4400', rest: '?to=/x' });
  assert.equal(LIB.urlParts('  https://example.com  ').rest, '', 'a bare origin has no rest, and whitespace is trimmed');
});

test('anything that is not an http(s) url stays a text box', () => {
  for (const v of [null, undefined, '', '   ', 42, 'not a url', 'example.com/no-scheme',
    'javascript:alert(1)', 'mailto:a@b.c', 'ftp://x.y/z', 'https://']) {
    assert.equal(LIB.urlParts(v), null, `${JSON.stringify(v)} is not a link`);
  }
});

test('the cell is a real anchor that opens a new tab and never hands the opener over', () => {
  const dressed = APP.slice(APP.indexOf('function dressedUrl('), APP.indexOf('function dressedUrl(') + 2500);
  assert.match(dressed, /target: '_blank'/);
  assert.match(dressed, /rel: 'noopener'/);
  assert.match(dressed, /class: 'url-dressed'/);
  assert.match(dressed, /class: 'url-edit'/, 'the pencil is the edit gesture');
  assert.match(APP, /f\.type === 'url' && globalThis\.WeaveEditorLib\.urlParts\(rawVal\)/, 'editorFor dresses a url the same way it dresses a number');
});

test('Return on the focused cell opens the editor through the pencil, not the link', () => {
  assert.match(APP, /\.num-dressed, \.text-dressed, \.url-edit/, 'the keymap reaches the pencil');
  assert.equal(LIB.cellActivation('url'), 'focus-input');
});

test('the costume has its style and the Handbook says how to edit', () => {
  assert.match(CSS, /\.url-dressed \{/);
  assert.match(CSS, /\.url-dressed \.url-host \{/);
  assert.match(CSS, /\.url-edit/);
  assert.match(HANDBOOK, /pencil/, 'the url page names the edit gesture');
});
