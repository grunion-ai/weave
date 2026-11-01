import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, CSS, rulesFor, fnBody, fnBodyOf, liftFunction } from './lib/source.mjs';

test('public/app.js parses (source greps are not a parse gate; this is)', () => {
  assert.doesNotThrow(() => new Function(APP));
});

test('rulesFor reads merged declarations for a selector', () => {
  const main = rulesFor('#main');
  assert.equal(main.position, 'relative');
  assert.ok(main.padding, '#main should still declare padding');
  assert.deepEqual(rulesFor('#no-such-selector'), {});
  assert.ok(!CSS.includes('/*'), 'comments are stripped before selectors are read');
});

test('fnBody stops at the closing brace; fnBodyOf runs to the next top-level function', () => {
  const body = fnBody('accountDisplayName');
  assert.ok(body.startsWith('function accountDisplayName(') && body.endsWith('\n}'), 'one declaration, closed at column 0');
  const region = fnBodyOf('accountDisplayName');
  assert.ok(region.startsWith(body.trimEnd()), 'the region begins with the same declaration');
  assert.ok(region.length >= body.length, 'and carries what sits between it and the next one');
  assert.throws(() => fnBody('noSuchFunctionAnywhere'), /must exist/);
});

test('liftFunction returns a callable lifted from the source', () => {
  const accountDisplayName = liftFunction('accountDisplayName');
  assert.equal(typeof accountDisplayName, 'function');
  assert.equal(accountDisplayName('ada@example.com'), 'ada');
});

test('no replaceChildren call is handed a child that can be null (Issue #1234)', () => {
  const splitTopLevel = (text, isBoundary) => {
    let depth = 0, cur = '', out = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      if (depth === 0 && isBoundary(c, text, i)) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    return [...out, cur];
  };
  const argsOf = (text) => splitTopLevel(text, (c) => c === ',').map((p) => p.trim()).filter(Boolean);
  const isTernaryMark = (c, t, i) => (c === '?' && t[i + 1] !== '?' && t[i + 1] !== '.' && t[i - 1] !== '?') || c === ':';
  const isCoalesceMark = (c, t, i) => c === '?' && t[i + 1] === '?';
  const alreadyFilteredSpread = (part, close) => /^\s*\.filter\s*\(/.test(part.slice(close + 1));
  const childrenOf = (part) => {
    if (!part.startsWith('...[')) return [part];
    const close = part.lastIndexOf(']');
    return alreadyFilteredSpread(part, close) ? [] : argsOf(part.slice(4, close));
  };
  const canBeNull = (part) => {
    if (part === 'null') return true;
    const branches = splitTopLevel(part, isTernaryMark).slice(1);
    if (branches.some((b) => b.trim() === 'null')) return true;
    return splitTopLevel(part, isCoalesceMark).slice(1).some((b) => b.replace(/^\?/, '').trim() === 'null');
  };
  const stringifiedAsNull = [];
  for (const call of APP.matchAll(/\breplaceChildren\s*\(/g)) {
    for (const child of argsOf(APP.slice(call.index + call[0].length)).flatMap(childrenOf)) {
      if (canBeNull(child)) stringifiedAsNull.push(`line ${APP.slice(0, call.index).split('\n').length}: ${child.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(stringifiedAsNull, [], `replaceChildren stringifies a non-Node child, so each of these would render as the text "null". Filter them, or hand them to el(), which skips null children:\n${stringifiedAsNull.join('\n')}`);
});
