import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.match(html, /<a href="https:\/\/example.com">docs<\/a>/);
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
  const resolve = (db, pid) =>
    db === 'Task' && pid === '12' ? { href: '/e/abc', label: 'Task #12 — Fix login' } : null;
  const html = renderMarkdown('Blocked by [[Task#12]] and [[Task#12|the login fix]] and [[Nope#9]].', { resolveMention: resolve });
  assert.match(html, /<a class="mention" href="\/e\/abc">Task #12 — Fix login<\/a>/);
  assert.match(html, /<a class="mention" href="\/e\/abc">the login fix<\/a>/);
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
