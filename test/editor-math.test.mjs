import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KATEX = join(ROOT, 'public/vendor/vditor/dist/js/katex');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

test('the vendored tree carries every file the KaTeX render loads', () => {
  for (const rel of ['katex.min.js', 'katex.min.css', 'mhchem.min.js']) {
    assert.ok(existsSync(join(KATEX, rel)), `missing vendored asset: ${rel}`);
  }
  assert.ok(readFileSync(join(KATEX, 'mhchem.min.js'), 'utf8').length > 1000);
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
  assert.match(APP, /math:\s*\{\s*engine:\s*'KaTeX'\s*\}/);
});

test('the README says what math can and cannot do', () => {
  assert.match(README, /KaTeX/, 'the engine is named');
  assert.match(README, /graphviz|Graphviz/i, 'the excluded engines are named');
  assert.match(README, /katex[^\n]*0\.16/i, 'KaTeX joins the vendored-and-pinned credits');
});
