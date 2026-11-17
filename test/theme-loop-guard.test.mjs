import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST = import.meta.dirname;
const LOOP = /for \(const (\w+) of \[\s*(['"])(light|dark)\2\s*,\s*(['"])(light|dark)\4\s*\]\)\s*\{/g;
const PAINT = /colou?r|background|contrast|screenshot|rgba?\(|hsla?\(|oklch|fill|stroke|border|shadow|outline|tblr|paint|hue|palette|lumin|png|pixel|filter|opacity|gradient|scheme-|theme\b|mermaid|svg|icon|logo|image|img|src|canvas|visible|computed|styleOf|style/i;

export function closeOf(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

export function themeBlindLoops(src) {
  return [...src.matchAll(LOOP)].flatMap((m) => {
    const open = m.index + m[0].length - 1;
    const body = src.slice(open + 1, closeOf(src, open)).replace(new RegExp(`\\b${m[1]}\\b`, 'g'), '');
    return PAINT.test(body) ? [] : [src.slice(0, m.index).split('\n').length];
  });
}

test('the guard tells a theme-blind loop from one that reads paint (Issue #667)', () => {
  const blind = "for (const theme of ['light', 'dark']) {\n  test(`${theme}: rows fit`, async () => { assert.equal(box.width, 44); });\n}\n";
  const painted = "for (const theme of ['light', 'dark']) {\n  test(`${theme}: chip`, async () => { await styleOf(chip, 'color', want[theme]); });\n}\n";
  assert.deepEqual(themeBlindLoops(blind), [1]);
  assert.deepEqual(themeBlindLoops(painted), []);
  assert.deepEqual(themeBlindLoops("for (const scheme of ['light', 'dark']) {\n  const s = '}';\n  assert.ok(s);\n}\nconst color = 1;\n"), [1], 'a brace inside a string never ends the body early');
});

test('no browser suite runs both themes over a body that reads no colour, contrast or screenshot (Issue #667)', () => {
  const found = readdirSync(TEST).filter((f) => f.endsWith('-browser.test.mjs'))
    .flatMap((f) => themeBlindLoops(readFileSync(join(TEST, f), 'utf8')).map((line) => `test/${f}:${line}`));
  assert.deepEqual(found, [], 'a theme cannot change a geometry, a count, a class or a text value: run it in one theme (DEVELOPMENT.md "Theme loops")');
});
