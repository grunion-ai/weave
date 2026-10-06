import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KATEX = join(ROOT, 'public/vendor/vditor/dist/js/katex');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

await import('../public/editor-lib.js');

const fakeRoot = (nodes) => ({ querySelectorAll: () => nodes });
const mathNode = (attached = true) => ({ parentElement: attached ? {} : null });

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


test('the math element list skips a node that left the document (Issue #470)', () => {
  const kept = mathNode();
  const gone = mathNode(false);
  const list = globalThis.WeaveEditorLib.liveMathElements(fakeRoot([kept, gone, mathNode()]));
  assert.equal(list.length, 3, 'the length Vditor checks counts every node it collected');
  const seen = [];
  list.forEach((n) => seen.push(n));
  assert.equal(seen.length, 2, 'only the attached nodes reach the render callback');
  assert.ok(!seen.includes(gone), 'the detached node is skipped rather than read');
});

test('a node that leaves between collection and render is skipped, not thrown on', () => {
  const leaving = mathNode();
  const list = globalThis.WeaveEditorLib.liveMathElements(fakeRoot([leaving, mathNode()]));
  leaving.parentElement = null;
  const seen = [];
  assert.doesNotThrow(() => list.forEach((n) => seen.push(n)));
  assert.equal(seen.length, 1, 'the check runs at render time, which is when Vditor reads parentElement');
});

test('an empty collection answers a zero length, so Vditor skips the render entirely', () => {
  assert.equal(globalThis.WeaveEditorLib.liveMathElements(fakeRoot([])).length, 0);
});

test('app.js installs the guard on Vditor\'s own math adapter', () => {
  assert.match(APP, /adapterRender\?\.mathRenderAdapter/,
    'the guard goes through Vditor\'s adapter hook, never a patch to the vendored bundle');
  assert.match(APP, /guardMathRender\(\);/, 'and it runs before an editor mounts');
});
