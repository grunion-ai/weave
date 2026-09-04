/* Live [[…]] chips inside the IR editor (Issue #86).

   Vditor parses with Lute — compiled Go that cannot learn weave's reference
   syntax — so the chips are a decoration pass OVER the editing surface, never
   a rewrite of it: the contenteditable DOM belongs to Lute's serializer, and
   anything injected into it would leak into the stored markdown. The overlay
   paints resolved chips on top of the literal text, resolves through the same
   POST /api/markdown the previews use, and steps aside (literal text, plain
   editing) whenever the caret sits inside a reference.

   The pure text scanner lives in public/editor-lib.js — a classic script in
   the browser and an importable module here, which is what makes the grammar
   testable without a DOM. Geometry and caret behavior are covered by the
   browser suite in test/editor-phase4-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'public/index.html'), 'utf8');

/* ---------- the scanner speaks the same grammar as the renderer ---------- */

test('findRefSpans finds bare and labeled references with exact offsets', () => {
  const text = 'see [[Tasks#12]] and [[Roadmap/Tasks#3|the big one]] here';
  const spans = LIB.findRefSpans(text);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { start: 4, end: 16, ref: 'Tasks#12', label: null });
  assert.equal(text.slice(spans[0].start, spans[0].end), '[[Tasks#12]]');
  assert.deepEqual(spans[1], { start: 21, end: 52, ref: 'Roadmap/Tasks#3', label: 'the big one' });
  assert.equal(text.slice(spans[1].start, spans[1].end), '[[Roadmap/Tasks#3|the big one]]');
});

test('findRefSpans accepts the typed reference kinds', () => {
  const spans = LIB.findRefSpans('[[table:Space/Name]] [[space:Ops]] [[workspace]]');
  assert.deepEqual(spans.map((s) => s.ref), ['table:Space/Name', 'space:Ops', 'workspace']);
});

test('findRefSpans rejects what the renderer would reject', () => {
  assert.equal(LIB.findRefSpans('a [[broken\nref]] b').length, 0, 'no newlines inside a reference');
  assert.equal(LIB.findRefSpans('[[]]').length, 0, 'an empty reference is not a reference');
  assert.equal(LIB.findRefSpans('plain text').length, 0);
  assert.equal(LIB.findRefSpans('').length, 0);
  assert.equal(LIB.findRefSpans(null).length, 0);
});

test('the skip selector keeps chips out of code', () => {
  // Code is literal text by definition, and Vditor's own marker/preview
  // copies are not the writing surface.
  for (const part of ['pre', 'code', '.vditor-ir__marker', '.vditor-ir__preview']) {
    assert.ok(LIB.REF_SKIP_SELECTOR.split(',').map((s) => s.trim()).includes(part),
      `REF_SKIP_SELECTOR must exclude ${part}`);
  }
});

/* ---------- the decoration pass is wired, cheap, and reversible ---------- */

test('editor-lib loads as a classic script before app.js', () => {
  const lib = INDEX.indexOf('/editor-lib.js');
  const app = INDEX.indexOf('/app.js');
  assert.ok(lib > -1, 'index.html must load editor-lib.js');
  assert.ok(lib < app, 'the library must be defined before app.js uses it');
  assert.ok(!INDEX.slice(lib - 80, lib).includes('type="module"'),
    'a module script would race app.js; editor-lib is a classic script');
});

test('the overlay never rewrites the contenteditable DOM', () => {
  // The chips live in a sibling layer appended to the host, and the pass
  // reads the editing surface through a TreeWalker without touching it.
  assert.match(APP, /doc-ref-layer/);
  assert.match(APP, /createTreeWalker/);
  assert.ok(!/vditor-reset[^]{0,120}\.append\(chip/.test(APP),
    'chips must never be appended into the editing surface');
});

test('decoration is debounced and scoped to visible text', () => {
  assert.match(APP, /REF_CHIP_DEBOUNCE\s*=\s*\d+/, 'a named debounce for the pass');
  assert.match(APP, /innerHeight/, 'off-screen paragraphs must not pay for geometry');
});

test('references resolve through the same endpoint the previews use', () => {
  assert.match(APP, /api\('POST',\s*'\/markdown'/, 'POST /api/markdown is the one resolver');
  assert.match(APP, /refResolveCache/, 'resolution is cached per reference');
});

test('the caret degrades a chip back to literal text', () => {
  assert.match(APP, /selectionchange/, 'caret moves must re-evaluate chips');
});

test('teardown clears every decoration registry with the editors', () => {
  const teardown = APP.match(/function teardownDocEditors\(\)[^]{0,700}/)[0];
  // The registries scheduleDecorFor feeds are the registries teardown must
  // empty; docCodeAuto was left out once and its passes outlived the page.
  const scheduled = APP.match(/function scheduleDecorFor\(host\) \{\s*for \(const s of \[([^\]]+)\]\)/)[1]
    .split(',').map((n) => n.trim().replace(/^\.\.\./, ''));
  assert.ok(scheduled.length >= 4, `scheduleDecorFor names the registries: ${scheduled}`);
  for (const name of scheduled) {
    assert.match(teardown, new RegExp(`${name}\\.clear\\(\\)`), `${name} must be cleared on teardown`);
  }
});

/* ---------- the chip looks like the preview chip and stays clickable ---------- */

test('the layer is click-transparent except for the chips themselves', () => {
  assert.match(CSS, /\.doc-ref-layer\s*\{[^}]*pointer-events:\s*none/);
  assert.match(CSS, /\.doc-ref-chip[^{]*\{[^}]*pointer-events:\s*auto/);
});

test('editor chips reuse the preview mention styling', () => {
  // One visual language for references: the rule that paints preview chips
  // must cover the editor layer too, glyphs included.
  assert.match(CSS, /\.doc-preview a\.mention,\s*\.doc-ref-layer a\.mention/);
  assert.match(CSS, /\.doc-ref-layer \.mention-entity::before|\.doc-ref-layer \.mention-entity/);
});
