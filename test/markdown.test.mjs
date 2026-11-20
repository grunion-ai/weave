import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown, renderDocumentPage, parseBlocks } from '../src/markdown.js';

test('headings and paragraphs', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *italic* and `code`.');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test('links, images, strikethrough', () => {
  const html = renderMarkdown('See [docs](https://example.com) and ![alt](img.png) and ~~gone~~.');
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener">docs<\/a>/, 'a link that leaves weave opens a new tab');
  assert.match(html, /<img src="img.png" alt="alt">/);
  assert.match(html, /<del>gone<\/del>/);
});

test('code blocks preserve content and escape html', () => {
  const html = renderMarkdown('```js\nconst a = 1 < 2;\n```');
  assert.match(html, /<pre><code class="language-js">const a = 1 &lt; 2;<\/code><\/pre>/);
});

test('lists with nesting and task items', () => {
  const html = renderMarkdown('- one\n- two\n  - nested\n- [x] done\n- [ ] todo');
  assert.match(html, /<ul><li>one<\/li><li>two<ul><li>nested<\/li><\/ul><\/li>/);
  assert.match(html, /<input type="checkbox" disabled checked> done/);
  assert.match(html, /<input type="checkbox" disabled> todo/);
});

test('ordered lists', () => {
  const html = renderMarkdown('1. first\n2. second');
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('blockquote and hr', () => {
  const html = renderMarkdown('> quoted text\n\n---');
  assert.match(html, /<blockquote><p>quoted text<\/p>\n<\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('tables', () => {
  const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>1<\/td><td>2<\/td>/);
});

test('entity mentions resolve via callback', () => {
  const resolve = (kind, ref) =>
    kind === 'entity' && ref === 'Task#12' ? { href: '/e/abc', label: 'Task #12 — Fix login' } : null;
  const html = renderMarkdown('Blocked by [[Task#12]] and [[Task#12|the login fix]] and [[Nope#9]].', { resolveMention: resolve });
  assert.match(html, /<span class="k k-rel kind-entity"><a class="mention mention-entity" href="\/e\/abc" [^>]*><span class="k-label">Task #12 — Fix login<\/span><\/a><\/span>/);
  assert.match(html, /<span class="k-label">the login fix<\/span>/);
  assert.match(html, /<span class="mention broken">Nope#9<\/span>/);
});

test('html is escaped in text', () => {
  const html = renderMarkdown('Evil <script>alert(1)</script> text');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('parseBlocks block structure', () => {
  const blocks = parseBlocks('# H\n\npara\n\n```\ncode\n```\n\n- a\n- b\n\n| X |\n|---|\n| 1 |');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'code', 'list', 'table']);
});

test('full document page renders standalone html', () => {
  const page = renderDocumentPage({ title: 'My Doc', subtitle: 'Task #4', markdown: '# Hi\n\nBody' });
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<title>My Doc<\/title>/);
  assert.match(page, /<h1>Hi<\/h1>/);
  assert.match(page, /Task #4/);
});

test('a rendered document page gives every code block a copy button', () => {
  const page = renderDocumentPage({ title: 'D', subtitle: '', markdown: '```js\nconst x = 1;\n```' });
  assert.match(page, /code-copy/, 'the page builds a copy control for its code blocks');
  assert.match(page, /pre:not\(\.mermaid\)/, 'a mermaid diagram is a picture, not code to copy');
  assert.match(page, /position: absolute/, 'the button is pinned rather than pushed into the flow');
  assert.match(page, /@media print \{[\s\S]*?\.code-copy \{ display: none/,
    'a printed page (and every PDF export) must not carry a button');
  assert.match(page, /navigator\.clipboard/, 'copying uses the clipboard API');
});

test('isHtmlDocument: a complete HTML file, not a markdown doc with an HTML block', async () => {
  const { isHtmlDocument } = await import('../src/markdown.js');
  assert.ok(isHtmlDocument('<!DOCTYPE html>\n<html>'));
  assert.ok(isHtmlDocument('  <!doctype HTML>'));
  assert.ok(isHtmlDocument('<html lang="en"><body>'));
  assert.ok(!isHtmlDocument('# Heading\n\n<div>block</div>'));
  assert.ok(!isHtmlDocument('<div>just a block</div>'));
  assert.ok(!isHtmlDocument(''));
  assert.ok(!isHtmlDocument(null));
});

test('hard line breaks: two trailing spaces or a backslash become <br>', () => {
  assert.match(renderMarkdown('a  \nb'), /<p>a<br>\nb<\/p>/);
  assert.match(renderMarkdown('a\\\nb'), /<p>a<br>\nb<\/p>/);
  assert.match(renderMarkdown('> a  \n> b'), /a<br>/);
  assert.doesNotMatch(renderMarkdown('a\nb'), /<br>/);
  assert.doesNotMatch(renderMarkdown('a  '), /<br>/);
});

test('a mention-free document page carries no mention class, so no wait may key on the bare word', () => {
  const page = renderDocumentPage({ title: 'T', subtitle: 'S', markdown: 'A plain paragraph with no chips.' });
  assert.match(page, /mention/, 'the page script names .mention-caret even with nothing to mention');
  assert.doesNotMatch(page, /class="mention/, 'and nothing on it is a chip');
  const waiter = readFileSync(join(import.meta.dirname, 'slash-commands.test.mjs'), 'utf8');
  assert.doesNotMatch(waiter, /includes\('mention'\)/, 'a doc.html wait on the bare word never waits, so the GET races the PUT');
});

test('an exported page carries its chip stylesheet and favicon, so neither needs the serving origin (Issue #1600)', () => {
  const page = renderDocumentPage({ title: 'T', subtitle: '', markdown: 'plain words' });
  assert.doesNotMatch(page, /href="\/chip\.css"/, 'a root-relative stylesheet 404s from disk');
  assert.match(page, /\.k-rel, \.k-doc/, 'chip.css is inlined, so a chip keeps its outline wherever the file is opened');
  assert.doesNotMatch(page, /href="\/brand\/weave-favicon\.svg"/, 'the favicon travels with the page');
  assert.match(page, /href="data:image\/svg\+xml,/, 'as a data URI');
});

test('with an origin an exported page links mermaid, highlighting and the editor library absolutely (Issue #1600)', () => {
  const page = renderDocumentPage({ title: 'T', markdown: '```mermaid\ngraph LR\n  A --> B\n```\n\n```js\nconst x = 1;\n```', origin: 'https://weave.example' });
  assert.match(page, /src="https:\/\/weave\.example\/vendor\/mermaid\.min\.js"/);
  assert.match(page, /href="https:\/\/weave\.example\/vendor\/vditor\/dist\/js\/highlight\.js\/styles\/github\.min\.css"/);
  assert.match(page, /src="https:\/\/weave\.example\/editor-lib\.js"/);
  assert.doesNotMatch(page, /class="wv-export-note"/, 'the bundles resolve, so the page says nothing');
});

test('with no origin an exported page drops the bundles that would 404 and says so once (Issue #1600)', () => {
  const page = renderDocumentPage({ title: 'T', markdown: '```mermaid\ngraph LR\n  A --> B\n```\n\n```js\nconst x = 1;\n```' });
  assert.doesNotMatch(page, /mermaid\.min\.js/, 'a 404 leaves the diagram as source text with no word of why');
  assert.doesNotMatch(page, /highlight\.min\.js/);
  assert.doesNotMatch(page, /editor-lib\.js/);
  assert.match(page, /class="wv-export-note"/, 'one line names what is missing and how to get it');
  assert.match(page, /pre\.mermaid \{ text-align: left; \}/, 'an undrawn diagram reads as the source it is, left aligned, the way the dropped onerror handler left it');
  assert.match(page, /--origin/, 'and names the flag that links them');
});

test('a page with neither a diagram nor a code block says nothing about bundles (Issue #1600)', () => {
  const page = renderDocumentPage({ title: 'T', markdown: '# Hi\n\nJust prose.' });
  assert.doesNotMatch(page, /class="wv-export-note"/, 'a share page and a legal page carry no notice');
});
