import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';

const MOCKUPS = ['card-view-options.html', 'chip-anatomy-alternatives.html'];

function undefinedProperties(html) {
  const defined = new Set([...html.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const read = [...html.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]);
  return [...new Set(read.filter((name) => !defined.has(name)))];
}

for (const file of MOCKUPS) {
  test(`${file} defines every custom property it reads without a fallback`, () => {
    const html = readFileSync(join(ROOT, 'docs/mockups', file), 'utf8');
    assert.deepEqual(undefinedProperties(html), []);
  });

  test(`${file} sets --wv-hit on :root and under a coarse pointer`, () => {
    const html = readFileSync(join(ROOT, 'docs/mockups', file), 'utf8');
    assert.match(html, /:root[^{]*\{[^}]*--wv-hit: 24px/);
    assert.match(html, /@media \(pointer: coarse\) \{ :root[^{]*\{ --wv-hit: 44px/);
  });
}
