/* The readers under the source-regex suites, and the one parse gate.

   Source greps passed for a whole release while app.js failed to parse, so
   five files each grew an "app.js still parses" test. One is enough, and it
   lives beside the readers every one of those files now shares. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, CSS, rulesFor, fnBody, fnBodyOf, liftFunction } from './lib/source.mjs';

test('public/app.js parses (source greps are not a parse gate; this is)', () => {
  assert.doesNotThrow(() => new Function(APP));
});

test('rulesFor reads merged declarations for a selector', () => {
  // #main is declared twice in style.css; both declarations must merge.
  const main = rulesFor('#main');
  assert.equal(main.position, 'relative');
  assert.ok(main.padding, '#main should still declare padding');
  assert.deepEqual(rulesFor('#no-such-selector'), {});
  assert.ok(!CSS.includes('/*'), 'comments are stripped before selectors are read');
});

test('fnBody stops at the closing brace; fnBodyOf runs to the next top-level function', () => {
  const body = fnBody('fmtSize');
  assert.ok(body.startsWith('function fmtSize(') && body.endsWith('\n}'), 'one declaration, closed at column 0');
  const region = fnBodyOf('fmtSize');
  assert.ok(region.startsWith(body.trimEnd()), 'the region begins with the same declaration');
  assert.ok(region.length >= body.length, 'and carries what sits between it and the next one');
  assert.throws(() => fnBody('noSuchFunctionAnywhere'), /must exist/);
});

test('liftFunction returns a callable lifted from the source', () => {
  const fmtSize = liftFunction('fmtSize');
  assert.equal(typeof fmtSize, 'function');
  assert.match(fmtSize(0), /GB$/);
});
