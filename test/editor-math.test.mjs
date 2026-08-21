/* Math in the editor: KaTeX only (Issue #90).

   Vditor's math render, when the engine is KaTeX, loads exactly three files
   from the vendored tree — katex.min.css, katex.min.js, then mhchem.min.js —
   and the render callback lives inside mhchem's .then, so a missing mhchem
   silently kills ALL math, not just chemistry. The fonts ride along as the
   woff2 subset the stylesheet actually names (modern browsers take woff2
   first; the woff/ttf fallbacks in the css 404 harmlessly for archaeology
   browsers weave does not support).

   KaTeX is the ONLY optional engine vendored. Graphviz, echarts, plantuml,
   mindmap, abc and flowchart stay out of the tree on purpose — their fences
   degrade to plain code blocks — and the README documents that consequence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KATEX = join(ROOT, 'public/vendor/vditor/dist/js/katex');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const PINNED_KATEX = '0.16.47';

test('the vendored tree carries every file the KaTeX render loads', () => {
  for (const rel of ['katex.min.js', 'katex.min.css', 'mhchem.min.js']) {
    assert.ok(existsSync(join(KATEX, rel)), `missing vendored asset: ${rel}`);
  }
  // mhchem is not optional: Vditor's render chain is
  // katex.then(mhchem.then(render)) — no mhchem, no math at all.
  assert.ok(readFileSync(join(KATEX, 'mhchem.min.js'), 'utf8').length > 1000);
});

test('the vendored build is the pinned 0.16.x', () => {
  const js = readFileSync(join(KATEX, 'katex.min.js'), 'utf8');
  assert.ok(js.includes(PINNED_KATEX), `katex.min.js should carry ${PINNED_KATEX}`);
});

test('every woff2 the stylesheet names is vendored', () => {
  const css = readFileSync(join(KATEX, 'katex.min.css'), 'utf8');
  const fonts = [...new Set([...css.matchAll(/fonts\/([A-Za-z0-9_-]+\.woff2)/g)].map((m) => m[1]))];
  assert.ok(fonts.length >= 15, `the css should name the full font set, found ${fonts.length}`);
  for (const f of fonts) {
    assert.ok(existsSync(join(KATEX, 'fonts', f)), `missing vendored font: ${f}`);
  }
});

test('the editor pins the KaTeX engine explicitly', () => {
  // The default happens to be KaTeX, but the default is not a decision.
  // Naming it in the config is what makes "the other engines stay out"
  // a documented choice rather than an accident of Vditor's defaults.
  assert.match(APP, /math:\s*\{\s*engine:\s*'KaTeX'\s*\}/);
});

test('the README says what math can and cannot do', () => {
  assert.match(README, /KaTeX/, 'the engine is named');
  assert.match(README, /graphviz|Graphviz/i, 'the excluded engines are named');
  assert.match(README, /katex[^\n]*0\.16/i, 'KaTeX joins the vendored-and-pinned credits');
});
