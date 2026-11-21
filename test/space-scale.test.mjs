import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'test/space-baseline.json'), 'utf8'));
export const SCALE = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48];
const PROP = /(?<![\w-])(--[\w-]*(?:pad|gap|inset)[\w-]*|(?:padding|margin|scroll-padding|scroll-margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap|inset(?:-(?:inline|block)(?:-(?:start|end))?)?)\s*:\s*([^;}]+)/g;

const sheets = () => readdirSync(PUBLIC).filter((f) => f.endsWith('.css')).map((f) => ({ file: `public/${f}`, css: readFileSync(join(PUBLIC, f), 'utf8') }));
const fallback = (value) => value.replace(/var\(--wv-nudge,\s*1px\)/g, 'var(--wv-nudge)').replace(/var\(--wv-space-(\d+),\s*(\d+)px\)/g, (all, step, px) => (step === px ? `var(--wv-space-${step})` : all));
export const pixels = (value) => [...fallback(value).matchAll(/(-?\d*\.?\d+)px/g)].map((m) => Math.abs(Number(m[1])));
export const odd = (px) => Number.isInteger(px) && px % 2 === 1;
export const offScale = (px) => !SCALE.includes(px);
const decls = (css) => [...css.matchAll(PROP)].map((m) => ({ prop: m[1], value: m[2].trim(), line: css.slice(0, m.index).split('\n').length }));

test('pixels: a token fallback that repeats the token is no raw value (Feature #386)', () => {
  assert.deepEqual(pixels('var(--wv-nudge, 1px) 8px'), [8]);
  assert.deepEqual(pixels('var(--wv-space-8, 8px)'), []);
  assert.deepEqual(pixels('var(--wv-space-8, 6px)'), [6]);
  assert.deepEqual(pixels('calc(var(--wv-space-8) - var(--wv-nudge))'), []);
  assert.deepEqual(pixels('-7px 0 5px'), [7, 5]);
  assert.ok(odd(7) && !odd(6) && !odd(.5));
  assert.ok(offScale(6) && offScale(14) && !offScale(12));
});

test('the spacing scale and the nudge live in one block in public/style.css (Feature #386)', () => {
  const css = readFileSync(join(PUBLIC, 'style.css'), 'utf8');
  for (const step of SCALE.filter(Boolean)) {
    const defs = [...css.matchAll(new RegExp(`--wv-space-${step}\\s*:\\s*([^;}]+)`, 'g'))];
    assert.equal(defs.length, 1, `--wv-space-${step} is defined once`);
    assert.equal(defs[0][1].trim(), `${step}px`);
  }
  assert.deepEqual([...css.matchAll(/--wv-nudge\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()), ['1px'], '--wv-nudge is 1px, defined once');
});

test('padding, margin, gap and inset take no odd pixel value, and the raw pixels off the scale only fall: test/space-baseline.json (Feature #386)', () => {
  for (const { file, css } of sheets()) {
    const odds = [];
    const off = [];
    for (const d of decls(css)) {
      const px = pixels(d.value);
      if (px.some(odd)) odds.push(`${file}:${d.line} ${d.prop}: ${d.value}`);
      off.push(...px.filter(offScale).map(() => `${file}:${d.line} ${d.prop}: ${d.value}`));
    }
    const held = BASELINE[file] ?? { odd: 0, offScale: 0 };
    assert.ok(odds.length <= held.odd, `${file} has ${odds.length} odd spacing values, over its ${held.odd}. Use a --wv-space-* step, or --wv-nudge for a 1px border nudge:\n${odds.join('\n')}`);
    assert.ok(odds.length >= held.odd, `${file} has ${odds.length} odd spacing values, under its ${held.odd}: lower test/space-baseline.json`);
    assert.ok(off.length <= held.offScale, `${file} has ${off.length} raw pixels off the scale, over its ${held.offScale}:\n${[...new Set(off)].join('\n')}`);
    assert.ok(off.length >= held.offScale, `${file} has ${off.length} raw pixels off the scale, under its ${held.offScale}: lower test/space-baseline.json`);
  }
  for (const file of Object.keys(BASELINE)) assert.ok(sheets().some((s) => s.file === file), `${file} in the baseline is no stylesheet`);
});
