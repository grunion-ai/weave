import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const VDITOR = readFileSync(new URL('../public/vendor/vditor/dist/index.css', import.meta.url), 'utf8');
const SCALE = { meta: 11, secondary: 12, grid: 13, body: 14, doc: 16, h2: 18, h1: 20, title: 24 };
const FLOOR = 11;

const sizeValues = (css) => [...css.matchAll(/(?<![-\w])font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].replace(/!important/, '').trim());
const shorthands = (css) => [...css.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
const pxSizes = (css) => [...css.matchAll(/(?<![-\w])font(?:-size)?\s*:\s*[^;}]*?(?<![\w.-])(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));

test('the type scale is eight steps, each defined once (Kyle, 2026-09-26; Issue #383)', () => {
  const defs = [...CSS.matchAll(/--fs-([a-z0-9]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]);
  assert.equal(defs.length, Object.keys(SCALE).length, `one definition per step: ${defs.map((d) => d[0]).join(', ')}`);
  assert.deepEqual(Object.fromEntries(defs), Object.fromEntries(Object.entries(SCALE).map(([k, v]) => [k, `${v}px`])));
  assert.equal(new Set(Object.values(SCALE)).size, 8, 'eight distinct sizes');
});

test('every font-size in style.css reads a scale token (Issue #383)', () => {
  const ok = (v) => {
    const t = v.match(/^var\(--fs-([a-z0-9]+)\)$/);
    if (t) return t[1] in SCALE;
    return /^var\(--wv-(grid|chip)-font\)$/.test(v) || v === 'inherit' || v === '0';
  };
  const bad = sizeValues(CSS).filter((v) => !ok(v));
  assert.deepEqual(bad, [], 'off-scale font-size values');
  const loose = shorthands(CSS).filter((v) => v !== 'inherit' && !/var\(--fs-[a-z0-9]+\)/.test(v));
  assert.deepEqual(loose, [], 'a font shorthand sets its size from a token too');
});

test('the grid and chip aliases resolve to the grid step', () => {
  const alias = (name) => [...CSS.matchAll(new RegExp(`--wv-${name}-font\\s*:\\s*([^;}]+)`, 'g'))].map((m) => m[1].trim());
  assert.deepEqual(alias('chip'), ['var(--fs-grid)']);
  assert.ok(alias('grid').every((v) => v === 'var(--wv-chip-font)' || v === 'var(--fs-grid)'), alias('grid').join(', '));
});

test('no px font size under the 11px floor in style.css or the vendored editor sheet', () => {
  assert.deepEqual(pxSizes(CSS).filter((n) => n < FLOOR), [], 'style.css');
  assert.deepEqual(pxSizes(VDITOR).filter((n) => n < FLOOR), [], 'vditor index.css');
});

test('the vendored editor headings sit on the scale', () => {
  const want = { 1: SCALE.h1, 2: SCALE.h2, 3: SCALE.doc, 4: SCALE.doc, 5: SCALE.body, 6: SCALE.body };
  for (const [sel, mk] of [['.vditor-reset h', (n) => `\\.vditor-reset h${n}`], ['.vditor-sv .h', (n) => `\\.vditor-sv \\.h${n}`]]) {
    for (const [n, px] of Object.entries(want)) {
      const rule = VDITOR.match(new RegExp(`(?:^|\\})\\s*${mk(n)}\\s*\\{([^}]*)\\}`));
      assert.ok(rule, `${sel}${n} rule present`);
      assert.match(rule[1], new RegExp(`font-size:\\s*${px}px`), `${sel}${n} is ${px}px`);
    }
  }
});

test('the UI font is a deliberate system stack, with no Inter asked for and nothing to load', () => {
  assert.doesNotMatch(CSS, /Inter\b/, 'style.css names no Inter');
  assert.doesNotMatch(CSS, /@font-face/, 'and declares no face');
  const stack = CSS.match(/:root\s*\{[^}]*--tblr-font-sans-serif\s*:\s*([^;}]+)/);
  assert.ok(stack, ':root sets the sans stack Tabler reads');
  assert.match(stack[1], /^-apple-system,/, 'starting from the platform face');
  assert.match(stack[1], /sans-serif$/, 'and ending on the generic');
});
