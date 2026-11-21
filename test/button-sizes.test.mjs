import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUTTON_SIZES } from '../public/button-sizes.js';

const ROOT = new URL('..', import.meta.url).pathname;
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'test/button-baseline.json'), 'utf8'));
const FONTS = { secondary: 12, grid: 13, body: 14, doc: 16 };
const token = (name) => CSS.match(new RegExp(`${name}\\s*:\\s*([^;}]+)`))?.[1].trim();

const SUBJECT_TOKEN = /(?:^|[^\w-])(?:button(?![\w-])|\.btn(?![\w-])|\.btn-[\w-]+|\.[\w-]+-btn(?![\w-])|\.[\w-]+-fab(?![\w-])|\.nav-toggle(?![\w-])|\.crumb-(?:copy|more|nav)(?![\w-])|\.phone-(?:new|search)(?![\w-])|\.[\w-]+-close(?![\w-])|\.nav-menu(?![\w-])|\[role="button"\])/;
const subject = (sel) => {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && /[\s>+~]/.test(c)) last = i + 1;
  }
  return sel.slice(last);
};
export const isButton = (sel) => SUBJECT_TOKEN.test(subject(sel)) && !/::(before|after)/.test(sel);
const SIZING = /^(padding(?:-[a-z-]+)?|height|min-height|width)$/;
export const raw = (prop, value) => SIZING.test(prop) && /\d(px|rem|em)\b/.test(value) && !/var\(--wv-btn-/.test(value);

export function rawSizing(css) {
  const hits = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@')) walk(body);
      else {
        const sels = head.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(isButton);
        if (sels.length) {
          for (const d of body.split(';')) {
            const m = d.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/s);
            if (m && raw(m[1], m[2])) hits.push(`${sels.join(', ')} { ${m[1]}: ${m[2]} }`);
          }
        }
      }
      i = j;
    }
  };
  walk(css);
  return hits;
}

test('the button table: one row per step, heights climbing, a 44 px touch step, the control radius below it (Feature #387)', () => {
  assert.deepEqual(BUTTON_SIZES.map((r) => r.step), ['xs', 'sm', 'md', 'lg', 'touch', 'xl']);
  const heights = BUTTON_SIZES.map((r) => r.height);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b), 'steps climb');
  assert.equal(BUTTON_SIZES.find((r) => r.step === 'touch').height, 44, 'the touch step is the 44 px phone target');
  for (const r of BUTTON_SIZES) {
    assert.ok(r.icon <= r.height - 4, `${r.step}: the icon leaves room in a square button`);
    assert.equal(r.radius, r.height < 44 ? 'control' : 'pill', `${r.step}: radius`);
    for (const k of ['padX', 'gap']) assert.equal(r[k] % 4, 0, `${r.step}: ${k} is on the spacing grid`);
  }
});

test('public/style.css carries the same rows as public/button-sizes.js (Feature #387)', () => {
  for (const r of BUTTON_SIZES) {
    const at = (k) => token(`--wv-btn-${r.step}-${k}`);
    assert.equal(at('h'), `${r.height}px`, `${r.step} height`);
    assert.equal(at('px'), `${r.padX}px`, `${r.step} horizontal padding`);
    assert.equal(at('icon'), `${r.icon}px`, `${r.step} icon`);
    assert.equal(at('gap'), `${r.gap}px`, `${r.step} gap`);
    assert.equal(at('fs'), `var(--fs-${r.font})`, `${r.step} font`);
    assert.ok(FONTS[r.font], `${r.step} names a type step`);
    assert.equal(at('r'), `var(--wv-radius-${r.radius})`, `${r.step} radius`);
    assert.match(CSS, new RegExp(`\\.wv-btn-${r.step}\\b[^{]*\\{ --wv-btn-h: var\\(--wv-btn-${r.step}-h\\);`), `.wv-btn-${r.step} reads its row`);
  }
  assert.match(CSS, /^\.btn, \.wv-btn-lg \{/m, 'a Tabler button defaults to the lg step');
  assert.match(CSS, /^\.btn-sm, \.wv-btn-md \{/m, 'a small Tabler button is the md step');
  assert.match(CSS, /--tblr-btn-line-height: calc\(var\(--wv-btn-h\) - 2 \* var\(--tblr-btn-border-width, 1px\)\)/, "Tabler's height is the step's height");
});

test('rawSizing reads the subject of each selector and skips token values (Feature #387)', () => {
  assert.ok(isButton('#app .view-header :is(.crumb-row, .head-bar) :is(.table-search-btn, .dl-wrap > .dots-btn)'));
  assert.ok(isButton('.bug-fab') && isButton('.wv-toast-close') && isButton('button.nav-space'));
  assert.ok(!isButton('.dots-btn svg') && !isButton('.crumb-copy::after') && !isButton('.btn-group .label'));
  assert.deepEqual(rawSizing('.x-btn { width: 24px; height: var(--wv-btn-h); padding: 0; }'), ['.x-btn { width: 24px }']);
  assert.deepEqual(rawSizing('@media (max-width: 1px) { .phone-new { height: 52px } }'), ['.phone-new { height: 52px }']);
});

test('raw padding, height, min-height and width on button selectors only fall: test/button-baseline.json (Feature #387)', () => {
  const hits = rawSizing(CSS);
  const held = BASELINE['public/style.css'];
  assert.ok(hits.length <= held, `${hits.length} raw button sizing declarations, over the baseline of ${held}. Give the button a step (.wv-btn-*) instead:\n${hits.join('\n')}`);
  assert.ok(hits.length >= held, `${hits.length} raw button sizing declarations, under the baseline of ${held}: lower test/button-baseline.json`);
});
