/* Inline icons in documents (Kyle, 2026-09-02: "show fully formatted real
   icons in the .md — these can replace emojis").
   `:bell:` draws the bell, `:check:` the tick, `:ring-quarter:` a progress
   ring, wherever markdown is shown: the server renderer (exports, previews),
   the dressed text cell, and the document editor, where the token is Lute's
   own shortcode node — the inventory REPLACES the GitHub emoji table, so a
   shortcode draws an inventory icon or stays literal, never an emoji. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { renderMarkdown, renderDocumentPage, inlineIconHtml } from '../src/markdown.js';
import { FORMATTING_SAMPLES, iconLibraryPage } from '../src/handbook.js';
await import('../public/editor-lib.js');
await import('../public/icon-registry.js');
const LIB = globalThis.WeaveEditorLib, reg = globalThis.weaveIconRegistry;
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const APP = src('public/app.js'), CSS = src('public/style.css');
const accept = (t) => { const h = reg.inline(t); return h ? (h.name ? `lucide:${h.name}` : h.mark) : null; };

test('the renderer draws :name: as the icon and leaves the rest of the text alone', () => {
  const html = renderMarkdown(':bell: rings');
  assert.match(html, /<span class="wv-icon md-icon mi mi-bell" data-ms="\d+" title="bell"><svg /);
  assert.match(html, /<\/span> rings/);
  assert.equal(renderMarkdown('at 12:30:45'), '<p>at 12:30:45</p>\n', 'a clock time is not an icon');
  assert.equal(renderMarkdown(':smile: :nope: :✓:'), '<p>:smile: :nope: :✓:</p>\n', 'an unknown token, an emoji shortcode and a bare character stay literal');
  assert.match(renderMarkdown('`:bell:`'), /<code>:bell:<\/code>/, 'code is literal by definition');
});

test('a mark draws by its twin or its ring alias', () => {
  assert.match(renderMarkdown(':check: done'), /mi-check/, 'the tick is the Lucide check');
  const ring = renderMarkdown(':ring-quarter: half');
  assert.match(ring, /class="wv-icon md-icon" title="ring-quarter"><svg [^>]*fill="currentColor"/, 'a ring has no twin and draws as drawn');
  assert.match(ring, /a9\.4 9\.4/);
  assert.equal(inlineIconHtml('B'), null, 'a letter is a letter');
  assert.deepEqual(reg.MARK_ALIASES, { '○': 'ring-empty', '◔': 'ring-quarter', '◐': 'ring-half-left', '◑': 'ring-half', '◕': 'ring-three-quarters', '●': 'ring-full' });
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

test('the tokenizer shares the grammar, and the caller vouches for names', () => {
  const tokens = LIB.inlineTokens('see :bell: **bold** :smile: :ring-quarter:', accept);
  assert.deepEqual(tokens.filter((t) => t.mark === 'icon'), [{ text: 'bell', mark: 'icon', icon: 'lucide:bell' }, { text: 'ring-quarter', mark: 'icon', icon: '◔' }]);
  assert.ok(tokens.some((t) => t.mark === null && t.text.includes(':smile:')), 'an unknown token is plain text');
  assert.deepEqual(LIB.inlineTokens(':bell:'), [{ text: ':bell:', mark: null }], 'no vouching, no icon');
  assert.match(LIB.ICON_TOKEN.source, /^:\(\[a-z0-9\]\[a-z0-9-\]\*\):$/, 'a token is letters, digits and dashes — the shape of a shortcode');
});

test('the document editor renders the inventory as its shortcode table, and nothing else', () => {
  assert.match(APP, /hint: \{ emoji: window\.weaveIconRegistry\?\.emojiTable\(\) \?\? \{\}, emojiPath: '\/vendor\/icons'/, 'the completion popup is the inventory');
  assert.match(APP, /lute\?\.SetEmojis\?\.\(window\.weaveIconRegistry\?\.emojiTable\(\)/, "Lute's GitHub table is replaced, not merged into");
  assert.doesNotMatch(APP, /doc-icon-chip|findIconSpans/, 'no overlay: the token is a node of the surface itself');
  assert.doesNotMatch(CSS, /doc-icon-chip/);
  assert.match(CSS, /\.vditor-reset img\.emoji \{[^}]*width: 1\.05em/, 'the node is sized to the line');
  assert.match(CSS, /\[data-bs-theme="dark"\] \.vditor-reset img\.emoji \{[^}]*filter/, 'and recoloured for the dark theme');
  const table = reg.emojiTable();
  assert.equal(Object.keys(table).length, reg.NAMES.length + Object.keys(reg.MARK_ALIASES).length);
  for (const [name, file] of Object.entries(table)) {
    assert.equal(file, `/vendor/icons/${name}.svg`, 'the image path itself — Lute uses a custom value verbatim');
    assert.ok(existsSync(new URL(`../public${file}`, import.meta.url)), `${file} is served for the editor`);
  }
  assert.equal(table.smile, undefined, 'no emoji shortcode survives');
  const bell = src('public/vendor/icons/bell.svg');
  assert.match(bell, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" style="color:#1f2937"/, 'a standalone svg with its own ink');
  assert.doesNotMatch(bell, /data-mi/, 'still: an <img> cannot be animated from the page');
});

test('the formatting showcase and the icon library use the form themselves', () => {
  const sample = FORMATTING_SAMPLES.find((s) => s.name === 'Inline icons');
  assert.ok(sample, 'a construct row for inline icons');
  assert.equal(sample.syntax, '`:name:`');
  assert.match(sample.doc, /\| :bug: \|/, 'the sample puts an icon in a table');
  assert.match(sample.doc, /:ring-quarter:/, 'and names a ring by its alias');
  const page = iconLibraryPage();
  assert.match(page, /\| `✓` \| `lucide:check` \| :check: \|/, 'the marks table draws each mark by its twin');
  assert.match(page, /:ring-empty: :ring-quarter: :ring-half-left: :ring-half: :ring-three-quarters: :ring-full:/, 'the rings by their aliases');
  assert.ok((page.match(/^\| :[a-z0-9-]+: \| `lucide:[a-z0-9-]+` \|/gm) || []).length >= 120, 'the gallery draws every icon in the inventory beside its value');
  assert.doesNotMatch(page, /:[^a-z0-9\s|`'][^:\s]*:/, 'no bare-character token anywhere on the page');
  assert.ok(page.includes('/showcase/icons/hover.gif'), 'hover.gif shows the motion a still cannot');
  for (const g of ['load-wave.gif', 'picker-scroll.gif']) assert.ok(!page.includes(g), `${g} showed a trigger that no longer exists (Issue #192)`);
  assert.doesNotMatch(page, /plays \*\*once\*\* when the page loads/, 'the Handbook must not promise a load wave (Issue #192)');
});
