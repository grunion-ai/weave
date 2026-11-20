import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'test/radius-baseline.json'), 'utf8'));
export const SCALE = { chip: '4px', control: '6px', surface: '8px', panel: '12px', pill: '999px' };
const TOKEN = new RegExp(`^var\\(--wv-radius-(${Object.keys(SCALE).join('|')})(?:,\\s*(\\d+px))?\\)$`);
const token = (part) => { const m = part.match(TOKEN); return !!m && (!m[2] || m[2] === SCALE[m[1]]); };
const KEYWORD = new Set(['0', 'inherit', '50%']);

const sheets = () => readdirSync(PUBLIC).filter((f) => f.endsWith('.css')).map((f) => ({ file: `public/${f}`, css: readFileSync(join(PUBLIC, f), 'utf8') }));
const parts = (value) => value.replace(/\s*!important\s*$/, '').split(/\s*\/\s*|\s+(?![^(]*\))/).filter(Boolean);
export const raw = (value) => parts(value).filter((p) => !KEYWORD.has(p) && !token(p));
const decls = (css, pattern) => [...css.matchAll(pattern)].map((m) => ({ prop: m[1], value: m[2].trim(), line: css.slice(0, m.index).split('\n').length }));

test('raw: tokens, 0, inherit and 50% pass, anything else is raw (Feature #385)', () => {
  assert.deepEqual(raw('var(--wv-radius-control)'), []);
  assert.deepEqual(raw('0 0 var(--wv-radius-panel) var(--wv-radius-panel)'), []);
  assert.deepEqual(raw('50%'), []);
  assert.deepEqual(raw('inherit'), []);
  assert.deepEqual(raw('5px'), ['5px']);
  assert.deepEqual(raw('var(--tblr-border-radius)'), ['var(--tblr-border-radius)']);
  assert.deepEqual(raw('0 14px 14px 0'), ['14px', '14px']);
  assert.deepEqual(raw('var(--wv-radius-surface) !important'), []);
  assert.deepEqual(raw('var(--wv-radius-chip, 4px)'), [], 'a stylesheet read outside the app falls back to the step itself');
  assert.deepEqual(raw('var(--wv-radius-chip, 6px)'), ['var(--wv-radius-chip, 6px)'], 'and never to another value');
});

test('the radius scale lives in one block in public/style.css with the five steps (Feature #385)', () => {
  const css = readFileSync(join(PUBLIC, 'style.css'), 'utf8');
  for (const [step, px] of Object.entries(SCALE)) {
    const defs = decls(css, new RegExp(`(--wv-radius-${step})\\s*:\\s*([^;}]+)`, 'g'));
    assert.equal(defs.length, 1, `--wv-radius-${step} is defined once`);
    assert.equal(defs[0].value, px, `--wv-radius-${step} is ${px}`);
  }
});

test('every other radius token is an alias of a step, so there is one system (Feature #385)', () => {
  const bad = [];
  for (const { file, css } of sheets()) {
    for (const d of decls(css, /(--[\w-]*radius[\w-]*)\s*:\s*([^;}]+)/g)) {
      if (/^--wv-radius-(chip|control|surface|panel|pill)$/.test(d.prop)) continue;
      if (!token(d.value)) bad.push(`${file}:${d.line} ${d.prop}: ${d.value}`);
    }
  }
  assert.deepEqual(bad, [], 'alias each radius token to a --wv-radius-* step');
});

test('raw border-radius values only fall: the count per stylesheet matches test/radius-baseline.json (Feature #385)', () => {
  const counts = {};
  const found = [];
  for (const { file, css } of sheets()) {
    const hits = decls(css, /(border(?:-[a-z]+)*-radius)\s*:\s*([^;}]+)/g).filter((d) => raw(d.value).length);
    counts[file] = hits.length;
    found.push(...hits.map((d) => `${file}:${d.line} ${d.prop}: ${d.value}`));
  }
  for (const [file, n] of Object.entries(counts)) {
    const held = BASELINE[file] ?? 0;
    assert.ok(n <= held, `${file} has ${n} raw radii, over its baseline of ${held}. Use a --wv-radius-* step:\n${found.filter((f) => f.startsWith(file)).join('\n')}`);
    assert.ok(n >= held, `${file} has ${n} raw radii, under its baseline of ${held}: lower test/radius-baseline.json to ${n}`);
  }
  for (const file of Object.keys(BASELINE)) assert.ok(file in counts, `${file} in the baseline is no stylesheet`);
});
