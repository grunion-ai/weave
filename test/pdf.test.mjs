import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { markdownToPdf, stripInline, unicodeFont } from '../src/pdf.js';
import { tempDir } from './lib/temp.mjs';

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

  assert.match(s, /\/Type \/Catalog/);
  assert.match(s, /\/Type \/Pages/);
  assert.match(s, /\/BaseFont \/Helvetica-Bold/);
  assert.match(s, /\/Encoding \/WinAnsiEncoding/);
  assert.match(s, /Test Doc/, 'title text present in stream');
  assert.match(s, /item one/, 'list text present');
  assert.match(s, /\\\(parens\\\)/, 'parens escaped');

  assert.match(s, /caf\\351/, 'é rendered as octal 351');

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

  assert.match(s, /\/Subtype \/Type0/);
  assert.match(s, /\/Encoding \/Identity-H/);
  assert.match(s, /\/Subtype \/CIDFontType2/);
  assert.match(s, /\/CIDToGIDMap \/Identity/);
  assert.match(s, /\/FontFile2 \d+ 0 R/);
  assert.match(s, /\/Filter \/FlateDecode/);

  assert.match(s, /\/ToUnicode \d+ 0 R/);
  assert.match(s, /beginbfchar/);
  assert.match(s, /<041f>/i, 'bfchar maps a CID to U+041F');

  const uni = unicodeFont();
  const gid = uni.gidFor(0x041f);
  assert.ok(gid > 0, 'DejaVu has a П glyph');
  assert.ok(s.includes(gid.toString(16).padStart(4, '0')), 'content stream uses the cmap gid');

  assert.match(s, /\/Encoding \/WinAnsiEncoding/);
});

test('unicode font exposes real metrics from the TTF tables', () => {
  const uni = unicodeFont();
  assert.ok(uni.unitsPerEm > 0);
  const gid = uni.gidFor(0x0410);
  assert.ok(gid > 0);
  const w = uni.widthFor(gid);
  assert.ok(w > 100 && w < 2000, `plausible advance width, got ${w}`);
  assert.ok(uni.gidFor(0x2192) > 0, '→ has a glyph');
  assert.ok(uni.gidFor(0x2713) > 0, '✓ has a glyph');
});

test('glyphs missing from DejaVu fall back to a visible box, not "?"', () => {
  const uni = unicodeFont();
  assert.equal(uni.gidFor(0x6f22), 0, 'DejaVu has no CJK (漢)');
  const boxGid = uni.gidFor(0x25a1);
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
  const dir = tempDir('weave-pdf-');
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

test('a missing unicode font degrades the PDF, never the process (G2)', async () => {
  const { mkdtempSync, cpSync, rmSync, symlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = tempDir('weave-pdf-nofont-');
  try {
    cpSync(new URL('../src', import.meta.url).pathname, join(dir, 'src'), { recursive: true, filter: (from) => !from.includes('/vendor/fonts') });
    symlinkSync(new URL('../public', import.meta.url).pathname, join(dir, 'public'));
    const mod = await import(join(dir, 'src', 'pdf.js'));
    assert.equal(mod.unicodeFont(), null, 'font resolution fails closed');
    const pdf = mod.markdownToPdf('# Привет\n\nКириллица without a font.', { title: 'т' });
    assert.ok(pdf.length > 500, 'a real PDF still renders');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'and it is a PDF');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the PDF font lives beside the writer, outside the static web root (Issue #659)', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  assert.ok(fs.existsSync(path.join(root, 'src/vendor/fonts/DejaVuSans.ttf')), 'src/pdf.js reads its font from src/vendor/fonts');
  assert.ok(fs.existsSync(path.join(root, 'src/vendor/fonts/DejaVuSans-LICENSE.txt')), 'the licence travels with it');
  assert.ok(!fs.existsSync(path.join(root, 'public/vendor/fonts')), 'public/ no longer serves the 757 KB font no page loads');
});

function embeddedFont(s) {
  const id = s.match(/\/FontFile2 (\d+) 0 R/)[1];
  const at = s.indexOf(`\n${id} 0 obj\n`);
  const head = s.slice(at).match(/<< \/Length (\d+) \/Filter \/FlateDecode \/Length1 (\d+) >>\nstream\n/);
  const start = at + s.slice(at).indexOf(head[0]) + head[0].length;
  const ttf = zlib.inflateSync(Buffer.from(s.slice(start, start + Number(head[1])), 'latin1'));
  assert.equal(ttf.length, Number(head[2]), 'Length1 is the decoded font length');
  return ttf;
}

function ttfTables(buf) {
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = { sum: buf.readUInt32BE(o + 4), off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  return tables;
}

function glyphBytes(buf) {
  const t = ttfTables(buf);
  const long = buf.readInt16BE(t.head.off + 50) === 1;
  const at = (gid) => (long ? buf.readUInt32BE(t.loca.off + gid * 4) : buf.readUInt16BE(t.loca.off + gid * 2) * 2);
  return (gid) => buf.subarray(t.glyf.off + at(gid), t.glyf.off + at(gid + 1));
}

test('one arrow and one emoji embed a subset of DejaVu holding only the glyphs used, not the whole font (Issue #1599)', () => {
  const md = '# Plan\n\nShip it → then rest \u{1f389}\n';
  const buf = markdownToPdf(md, { title: 'Plan' });
  assert.ok(buf.length < 40_000, `the PDF is ${buf.length} bytes`);
  const s = buf.toString('latin1');
  checkXref(s);
  assert.match(s, /\/BaseFont \/[A-Z]{6}\+DejaVuSans/, 'the subset carries a six-letter tag');
  const sub = embeddedFont(s);
  const full = fs.readFileSync(new URL('../src/vendor/fonts/DejaVuSans.ttf', import.meta.url));
  const uni = unicodeFont();
  assert.equal(sub.readUInt16BE(ttfTables(sub).maxp.off + 4), uni.numGlyphs, 'glyph ids keep their numbering for /CIDToGIDMap /Identity');
  const [a, b] = [glyphBytes(full), glyphBytes(sub)];
  for (const cp of [0x2192, 0x25a1, 0x53, 0x68]) {
    const gid = uni.gidFor(cp);
    assert.ok(a(gid).length > 0);
    assert.deepEqual(b(gid), a(gid), `glyph ${gid} for U+${cp.toString(16)} is copied whole`);
  }
  assert.equal(b(uni.gidFor(0x041f)).length, 0, 'an unused glyph is empty');
  assert.equal(b(0).length, a(0).length, 'the notdef glyph stays');
});

test('a subset font keeps the components of a composite glyph and valid table checksums (Issue #1599)', () => {
  const s = markdownToPdf('Ångström Ő →', { title: 'x' }).toString('latin1');
  const sub = embeddedFont(s);
  const full = fs.readFileSync(new URL('../src/vendor/fonts/DejaVuSans.ttf', import.meta.url));
  const uni = unicodeFont();
  const [a, b] = [glyphBytes(full), glyphBytes(sub)];
  const gid = uni.gidFor(0x0150);
  const g = a(gid);
  assert.ok(g.readInt16BE(0) < 0, 'U+0150 is a composite glyph in DejaVu Sans');
  let o = 10;
  for (;;) {
    const flags = g.readUInt16BE(o);
    const part = g.readUInt16BE(o + 2);
    assert.deepEqual(b(part), a(part), `component ${part} is kept`);
    if (!(flags & 0x20)) break;
    o += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
  }
  for (const [tag, t] of Object.entries(ttfTables(sub))) {
    if (tag === 'head') continue;
    let sum = 0;
    const padded = Buffer.concat([sub.subarray(t.off, t.off + t.len), Buffer.alloc(3)]);
    for (let i = 0; i < t.len; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
    assert.equal(sum, t.sum, `${tag} checksum`);
  }
});

test('a table cell too wide for its column ends in an ellipsis, and a cell that fits is left whole (Issue #1599)', () => {
  const long = 'word '.repeat(60).trim();
  const md = `| Name | Notes |\n|---|---|\n| short | ${long} |\n`;
  const s = markdownToPdf(md, { title: 'T' }).toString('latin1');
  assert.match(s, /\((?:word )+word?\\205\) Tj/, 'the cut cell ends in the WinAnsi ellipsis');
  assert.match(s, /\(Notes\) Tj/, 'the header that fits its column is whole');
  assert.doesNotMatch(s, /\(Notes\\205\) Tj/);
});

test('stripInline drops a backslash escape and keeps the punctuation (Issue #1902)', () => {
  assert.equal(stripInline('\\- X and 7\\) Y'), '- X and 7) Y');
  assert.equal(stripInline('\\*a\\*'), '*a*');
  assert.equal(stripInline('\\_a\\_ and \\`b\\`'), '_a_ and `b`');
  assert.equal(stripInline('C:\\dir'), 'C:\\dir');
  assert.equal(stripInline('`\\*x\\*`'), '\\*x\\*', 'escapes inside a code span stay literal');
});
