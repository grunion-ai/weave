/* Inline icons in documents (Kyle, 2026-09-02: "show fully formatted real
   icons in the .md — these can replace emojis").
   `:bell:` draws the bell, `:✓:` draws the mark, wherever markdown is shown:
   the server renderer (exports, previews), the dressed text cell, and the
   editor's chip layer, which paints the icon over the literal the same way it
   paints a [[reference]]. A token the set does not know stays literal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, renderDocumentPage, inlineIconHtml } from '../src/markdown.js';
import { FORMATTING_SAMPLES, iconLibraryPage } from '../src/handbook.js';
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const APP = src('public/app.js'), CSS = src('public/style.css');
const accept = (t) => (globalThis.weaveIconRegistry.resolve(`lucide:${t}`) ? `lucide:${t}` : globalThis.weaveMarkIcons.has(t) ? t : null);

test('the renderer draws :name: as the icon and leaves the rest of the text alone', () => {
  const html = renderMarkdown(':bell: rings');
  assert.match(html, /<span class="wv-icon md-icon mi mi-bell" data-ms="\d+" title="bell"><svg /);
  assert.match(html, /<\/span> rings/);
  assert.equal(renderMarkdown('at 12:30:45'), '<p>at 12:30:45</p>\n', 'a clock time is not an icon');
  assert.equal(renderMarkdown(':smile: :nope:'), '<p>:smile: :nope:</p>\n', 'a token the set does not know stays literal');
  assert.match(renderMarkdown('`:bell:`'), /<code>:bell:<\/code>/, 'code is literal by definition');
});

test('a mark draws as its twin, a ring as itself', () => {
  assert.match(renderMarkdown(':✓: done'), /mi-check/, 'the tick is the Lucide check');
  const ring = renderMarkdown(':◔: half');
  assert.match(ring, /class="wv-icon md-icon" title="◔"><svg [^>]*fill="currentColor"/, 'a ring has no twin and draws as drawn');
  assert.match(ring, /a9\.4 9\.4/);
  assert.equal(inlineIconHtml('B'), null, 'a letter is a letter');
});

test('icons sit inside table cells and inline marks', () => {
  const html = renderMarkdown('| a |\n| --- |\n| :bug: **x** |');
  assert.match(html, /<td><span class="wv-icon md-icon mi mi-bug"[^>]*>.*<\/span> <strong>x<\/strong><\/td>/);
});

test('an exported document page sizes an inline icon to its line', () => {
  const page = renderDocumentPage({ title: 'T', markdown: ':bell:' });
  assert.match(page, /\.md-icon \{[^}]*width: 1em/);
  assert.match(page, /mi-bell/);
});

test('the tokenizer and the span finder share the grammar, and the caller vouches for names', () => {
  const tokens = LIB.inlineTokens('see :bell: **bold** :smile: :✓:', accept);
  assert.deepEqual(tokens.filter((t) => t.mark === 'icon'), [{ text: 'bell', mark: 'icon', icon: 'lucide:bell' }, { text: '✓', mark: 'icon', icon: '✓' }]);
  assert.ok(tokens.some((t) => t.mark === null && t.text.includes(':smile:')), 'an unknown token is plain text');
  assert.deepEqual(LIB.inlineTokens(':bell:'), [{ text: ':bell:', mark: null }], 'no vouching, no icon');
  assert.deepEqual(LIB.findIconSpans('a :bell: b :nope: 12:30:45 :✓:', accept),
    [{ start: 2, end: 8, token: 'bell', icon: 'lucide:bell' }, { start: 27, end: 30, token: '✓', icon: '✓' }]);
});

test('the browser paints icons where it paints references, and dresses cells with them', () => {
  assert.match(APP, /lib\.findIconSpans\(n\.nodeValue, inlineIconAccept\)/, 'the chip layer scans for icon tokens');
  assert.match(APP, /class: 'doc-icon-chip'/, 'and paints an icon chip');
  assert.match(APP, /t\.mark === 'icon'.*iconEl\(t\.icon, 'wv-icon md-icon'\)/, 'a dressed cell draws the icon');
  assert.equal((APP.match(/inlineTokens\([^)]*inlineIconAccept\)/g) || []).length, 3, 'every inline tokenizer call vouches through the one hook');
  assert.match(CSS, /\.doc-ref-layer \.doc-icon-chip \{[^}]*pointer-events: none/, 'the chip is inert — the caret underneath stays reachable');
  assert.match(CSS, /\.wv-icon\.md-icon \{[^}]*width: 1em/, 'inline icons take the line height, not the chrome scale');
});

test('the formatting showcase and the icon library use the form themselves', () => {
  const sample = FORMATTING_SAMPLES.find((s) => s.name === 'Inline icons');
  assert.ok(sample, 'a construct row for inline icons');
  assert.equal(sample.syntax, '`:name:`');
  assert.match(sample.doc, /\| :bug: \|/, 'the sample puts an icon in a table');
  const page = iconLibraryPage();
  assert.match(page, /\| `✓` \| `lucide:check` \| :✓: \|/, 'the marks table draws each mark');
  assert.ok((page.match(/^\| :[a-z0-9-]+: \| `[a-z0-9-]+` \|/gm) || []).length >= 555, 'the gallery draws every icon beside its name');
  for (const g of ['load-wave.gif', 'hover.gif', 'picker-scroll.gif']) assert.ok(page.includes(`/showcase/icons/${g}`), `${g} shows the motion a still cannot`);
});
