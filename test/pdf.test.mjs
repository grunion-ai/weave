import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToPdf, stripInline } from '../src/pdf.js';

const SAMPLE = `# Overview

This is a **test** document with a [link](https://example.com) and \`code\`.

## Details

- item one
- item two
  - nested item
- [x] done thing

> A quoted insight worth keeping.

| Metric | Value |
|--------|-------|
| Speed  | Fast  |
| Cost   | Low   |

\`\`\`js
const x = compute(1, 2);
\`\`\`

Final paragraph with special chars: (parens) and \\backslash\\ and émigré café.
`;

test('stripInline removes markdown syntax', () => {
  assert.equal(stripInline('**bold** and *em* and `code` and [x](http://y)'), 'bold and em and code and x');
  assert.equal(stripInline('[[Task#3|label]] then [[Task#4]]'), 'label then Task#4');
});

test('generates structurally valid PDF', () => {
  const buf = markdownToPdf(SAMPLE, { title: 'Test Doc', subtitle: 'Weave • Task #1' });
  const s = buf.toString('latin1');

  assert.ok(s.startsWith('%PDF-1.4'), 'starts with PDF header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'ends with EOF marker');

  // startxref points at the xref table.
  const m = s.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(m, 'has startxref');
  const xrefAt = Number(m[1]);
  assert.equal(s.slice(xrefAt, xrefAt + 4), 'xref', 'startxref offset is correct');

  // Every xref entry points at the matching "N 0 obj".
  const xrefSection = s.slice(xrefAt);
  const count = Number(xrefSection.match(/xref\n0 (\d+)/)[1]);
  const entries = xrefSection.match(/\d{10} \d{5} [nf]/g);
  assert.equal(entries.length, count);
  entries.slice(1).forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    assert.ok(
      s.slice(offset).startsWith(`${i + 1} 0 obj`),
      `xref entry ${i + 1} points at object ${i + 1} (offset ${offset})`
    );
  });

  // Catalog, pages, fonts, and content all present.
  assert.match(s, /\/Type \/Catalog/);
  assert.match(s, /\/Type \/Pages/);
  assert.match(s, /\/BaseFont \/Helvetica-Bold/);
  assert.match(s, /\/Encoding \/WinAnsiEncoding/);
  assert.match(s, /Test Doc/, 'title text present in stream');
  assert.match(s, /item one/, 'list text present');
  assert.match(s, /\\\(parens\\\)/, 'parens escaped');

  // Latin-1 accents encoded as octal escapes, not dropped.
  assert.match(s, /caf\\351/, 'é rendered as octal 351');

  // WinAnsi typographic chars map to their WinAnsi bytes (• = 149 = \225).
  const bullets = markdownToPdf('- item', { title: 'B', subtitle: 'a • b' }).toString('latin1');
  assert.match(bullets, /\\225/, '• rendered via WinAnsi byte 149');
});

test('long documents paginate', () => {
  const long = Array.from({ length: 120 }, (_, i) => `Paragraph number ${i} with enough words to occupy a line or two of output in the page.`).join('\n\n');
  const buf = markdownToPdf(long, { title: 'Long' });
  const s = buf.toString('latin1');
  const count = Number(s.match(/\/Count (\d+)/)[1]);
  assert.ok(count >= 2, `expected multiple pages, got ${count}`);
});

test('empty document still renders', () => {
  const buf = markdownToPdf('', { title: 'Empty' });
  assert.ok(buf.toString('latin1').startsWith('%PDF-1.4'));
});
