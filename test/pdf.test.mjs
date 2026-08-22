import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markdownToPdf, stripInline, unicodeFont } from '../src/pdf.js';

// Shared structural check: startxref points at the xref table and every xref
// entry points at its matching "N 0 obj".
function checkXref(s) {
  assert.ok(s.startsWith('%PDF-1.4'), 'starts with PDF header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'ends with EOF marker');
  const m = s.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(m, 'has startxref');
  const xrefAt = Number(m[1]);
  assert.equal(s.slice(xrefAt, xrefAt + 4), 'xref', 'startxref offset is correct');
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
}

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

  checkXref(s);

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

const UNICODE_MD = 'Привет мир\n\nSymbols: → ✓';

test('non-WinAnsi text embeds DejaVu Sans with Identity-H', () => {
  const buf = markdownToPdf(UNICODE_MD, { title: 'Unicode' });
  const s = buf.toString('latin1');

  checkXref(s);

  // Type0 composite font wired to a CIDFontType2 descendant with the TTF embedded.
  assert.match(s, /\/Subtype \/Type0/);
  assert.match(s, /\/Encoding \/Identity-H/);
  assert.match(s, /\/Subtype \/CIDFontType2/);
  assert.match(s, /\/CIDToGIDMap \/Identity/);
  assert.match(s, /\/FontFile2 \d+ 0 R/);
  assert.match(s, /\/Filter \/FlateDecode/);

  // ToUnicode CMap present and maps back to real codepoints (П = U+041F),
  // so copy/paste and search work.
  assert.match(s, /\/ToUnicode \d+ 0 R/);
  assert.match(s, /beginbfchar/);
  assert.match(s, /<041f>/i, 'bfchar maps a CID to U+041F');

  // Glyph ids come from the real cmap: the content stream shows the text as a
  // hex string containing the gid for П.
  const uni = unicodeFont();
  const gid = uni.gidFor(0x041f);
  assert.ok(gid > 0, 'DejaVu has a П glyph');
  assert.ok(s.includes(gid.toString(16).padStart(4, '0')), 'content stream uses the cmap gid');

  // Base fonts remain for the Latin parts of the doc.
  assert.match(s, /\/Encoding \/WinAnsiEncoding/);
});

test('unicode font exposes real metrics from the TTF tables', () => {
  const uni = unicodeFont();
  assert.ok(uni.unitsPerEm > 0);
  const gid = uni.gidFor(0x0410); // А
  assert.ok(gid > 0);
  const w = uni.widthFor(gid); // 1/1000 em units
  assert.ok(w > 100 && w < 2000, `plausible advance width, got ${w}`);
  // Arrow and check mark are covered.
  assert.ok(uni.gidFor(0x2192) > 0, '→ has a glyph');
  assert.ok(uni.gidFor(0x2713) > 0, '✓ has a glyph');
});

test('glyphs missing from DejaVu fall back to a visible box, not "?"', () => {
  const uni = unicodeFont();
  assert.equal(uni.gidFor(0x6f22), 0, 'DejaVu has no CJK (漢)');
  const boxGid = uni.gidFor(0x25a1); // □ WHITE SQUARE
  assert.ok(boxGid > 0, 'DejaVu has □');

  const s = markdownToPdf('CJK: 漢字', { title: 'CJK' }).toString('latin1');
  assert.ok(s.includes(boxGid.toString(16).padStart(4, '0')), 'missing glyph renders as □');
});

test('pure-ASCII docs stay Helvetica-only — no embedded font', () => {
  const buf = markdownToPdf(SAMPLE, { title: 'Test Doc', subtitle: 'Plain' });
  const s = buf.toString('latin1');
  assert.doesNotMatch(s, /FontFile2/);
  assert.doesNotMatch(s, /\/Subtype \/Type0/);
  assert.doesNotMatch(s, /ToUnicode/);
  assert.ok(buf.length < 100 * 1024, `ASCII doc must not carry the TTF (got ${buf.length} bytes)`);
});

test('unicode PDF written to disk has a well-formed xref trailer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-pdf-'));
  const file = path.join(dir, 'unicode.pdf');
  try {
    fs.writeFileSync(file, markdownToPdf(UNICODE_MD, { title: 'Round trip' }));
    const s = fs.readFileSync(file).toString('latin1');
    checkXref(s);
    assert.match(s, /\/Root \d+ 0 R/);
    assert.match(s, /\/Type \/Catalog/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
