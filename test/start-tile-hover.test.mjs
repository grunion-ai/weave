import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/start.html', import.meta.url), 'utf8');

test('a start page tile stays put under the pointer (Issue #1001)', () => {
  const hover = css.match(/\.app:hover \{[^}]*\}/)?.[0];
  assert.ok(hover, 'the tile has a hover rule');
  assert.doesNotMatch(hover, /transform|translate|margin|top:/, 'hovering moves no edge of the tile, so a pointer resting on its edge cannot flicker');
});
