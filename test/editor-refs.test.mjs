import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = ['public/app.js', 'public/doc-editor.js'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const CSS = [readFileSync(join(ROOT, 'public/chip.css'), 'utf8'), readFileSync(join(ROOT, 'public/style.css'), 'utf8')].join('\n');
const INDEX = readFileSync(join(ROOT, 'public/index.html'), 'utf8');

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
  for (const part of ['pre', 'code', '.vditor-ir__marker', '.vditor-ir__preview']) {
    assert.ok(LIB.REF_SKIP_SELECTOR.split(',').map((s) => s.trim()).includes(part),
      `REF_SKIP_SELECTOR must exclude ${part}`);
  }
});

test('editor-lib loads as a classic script before app.js', () => {
  const lib = INDEX.indexOf('/editor-lib.js');
  const app = INDEX.indexOf('/app.js');
  assert.ok(lib > -1, 'index.html must load editor-lib.js');
  assert.ok(lib < app, 'the library must be defined before app.js uses it');
  assert.ok(!INDEX.slice(lib - 80, lib).includes('type="module"'),
    'a module script would race app.js; editor-lib is a classic script');
});

test('the overlay never rewrites the contenteditable DOM', () => {
  assert.match(APP, /doc-ref-layer/);
  assert.match(APP, /createTreeWalker/);
  assert.ok(!/vditor-reset[^]{0,120}\.append\(chip/.test(APP),
    'chips must never be appended into the editing surface');
});

test('decoration is debounced', () => {
  assert.match(APP, /REF_CHIP_DEBOUNCE\s*=\s*\d+/, 'a named debounce for the pass');
});

test('references resolve through the same endpoint the previews use', () => {
  assert.match(APP, /api\('POST',\s*'\/markdown'/, 'POST /api/markdown is the one resolver');
  assert.match(APP, /refResolveCache/, 'resolution is cached per reference');
});

test('the caret degrades a chip back to literal text', () => {
  assert.match(APP, /selectionchange/, 'caret moves must re-evaluate chips');
});

test('every decoration registry is one list that schedule, teardown and dock release all walk (Feature #177)', () => {
  const names = APP.match(/const DOC_DECOR = \[([^\]]+)\]/)[1].split(',').map((n) => n.trim());
  const registries = [...APP.matchAll(/^const (\w+) = new Set\(\);$/gm)].map((m) => m[1]).filter((n) => APP.includes(`${n}.add(st)`));
  assert.deepEqual([...names].sort(), [...registries].sort(), 'every Set a decoration pass adds its state to is in DOC_DECOR');
  for (const fn of ['scheduleDecorFor', 'teardownDocEditors', 'releaseDockPanel']) {
    const body = APP.slice(APP.indexOf(`function ${fn}(`), APP.indexOf('\n}\n', APP.indexOf(`function ${fn}(`)));
    assert.match(body, /DOC_DECOR/, `${fn} walks DOC_DECOR`);
    for (const name of names) assert.doesNotMatch(body, new RegExp(`\\b${name}\\b`), `${fn} names no registry by hand`);
  }
  assert.match(APP, /function dropDecor\(st\) \{ clearTimeout\(st\.timer\); st\.stop\?\.\(\); \(st\.layer \?\? st\.rail\)\?\.remove\(\); \}/, 'one teardown per state');
});

test('the layer is click-transparent except for the chips themselves', () => {
  assert.match(CSS, /\.doc-ref-layer\s*\{[^}]*pointer-events:\s*none/);
  assert.match(CSS, /\.doc-ref-slot[^{]*\{[^}]*pointer-events:\s*auto/);
});

test('the editor chip is the one renderer’s markup, sized to its label (Issue #679)', () => {
  const draw = APP.match(/const slot = el\('span', \{\s*class: 'doc-ref-slot wv-prose'\s*\}\);[^]*?st\.layer\.append\(slot\);/)[0];
  assert.match(draw, /class: 'doc-ref-slot wv-prose'/, 'the slot is prose ground, not a second costume');
  assert.match(draw, /slot\.append\(hit\.chip\.cloneNode\(true\)\)/, 'the chip is the rendered document\'s own node, cloned, never re-parsed from a string');
  assert.match(APP, /const r = d\.slot\.getBoundingClientRect\(\);/, 'the hidden literal takes the chip\'s own measured width, so the chip is never cut to the literal (Issue #878)');
  assert.match(APP, /lib\.aliasRefSpans\(md/, 'a bare reference is stored aliased, so the literal reserves the room');
  assert.match(CSS, /\.k-rel:not\(\.has-id\) > \.mention-entity::before \{ content: "#"; \}/);
  assert.doesNotMatch(CSS, /a\.mention[^{]*\{[^}]*rgba\(var\(--tblr-primary-rgb\), \.08\)/, 'no tinted-link costume');
  assert.doesNotMatch(CSS, /\.doc-ref-slot[^{]*\{[^}]*box-shadow:\s*inset/, 'no tint painted over the chip');
});
