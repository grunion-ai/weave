import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './lib/source.mjs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const CSS = read('style.css');
const STEP = Object.fromEntries([...CSS.matchAll(/--fs-([a-z0-9]+):\s*([\d.]+)px/g)].map((m) => [m[1], `${m[2]}px`]));
const px = (v) => {
  const m = String(v).trim().replace(/^var\(--fs-([a-z0-9]+)\)/, (_, k) => STEP[k] ?? _).match(/^([\d.]+)(px|rem)$/);
  return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : null;
};

test('the app pages forbid the focus zoom with maximum-scale=1 (Issue #724)', () => {
  for (const page of ['index.html', '404.html']) {
    const tag = read(page).match(/<meta name="viewport" content="([^"]+)"/);
    assert.ok(tag, `${page} has a viewport tag`);
    assert.match(tag[1], /width=device-width/);
    assert.match(tag[1], /maximum-scale=1\b/, `${page} keeps iOS from zooming into a focused field`);
  }
});

test('on phones and coarse pointers one floor rule sets every text control to 16px (Issue #724)', () => {
  const floor = cssRules().find((r) => /max-width: 719px/.test(r.media) && /pointer: coarse/.test(r.media) && /font-size:\s*var\(--fs-doc\)\s*!important/.test(r.body));
  assert.ok(floor, 'a phone and coarse-pointer rule sets a 16px font with !important');
  for (const part of ['input:not(', 'textarea', 'select', '[contenteditable]']) assert.ok(floor.selector.includes(part), `the floor covers ${part}`);
  const spared = [...floor.selector.matchAll(/\):not\(([^)]*)\)\s*$/g)].flatMap((m) => m[1].split(',').map((c) => c.trim()));
  for (const cls of spared) {
    const sizes = cssRules().filter((r) => r.selector.split(',').some((s) => s.includes(cls))).map((r) => r.body.match(/font-size:\s*([^;]+)/)?.[1]).filter(Boolean);
    assert.ok(sizes.length, `${cls} is spared because it sets its own size`);
    for (const v of sizes) assert.ok(px(v) === null || px(v) >= 16, `${cls} is spared from the floor, so it may never drop below 16px (${v})`);
  }
});

test('no stylesheet rule can beat the floor with a smaller important font size (Issue #724)', () => {
  const beaten = cssRules().filter((r) => {
    const m = r.body.match(/font-size:\s*([^;!]+)!important/);
    return m && px(m[1]) !== null && px(m[1]) < 16;
  }).map((r) => r.selector);
  assert.deepEqual(beaten, []);
});
