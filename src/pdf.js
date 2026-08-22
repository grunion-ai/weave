// Zero-dependency PDF generator: renders an entity's markdown document to a
// valid, viewable PDF (US Letter). Pure-Latin text uses the 14 standard PDF
// fonts (no embedding, real Helvetica AFM metrics). A line containing glyphs
// outside WinAnsi (Cyrillic, Greek, arrows, box drawing, …) switches whole to
// vendored DejaVu Sans, embedded as a CIDFontType2 with Identity-H encoding
// and a ToUnicode CMap — so ASCII docs stay small and Unicode docs stay
// copy/paste-able. DejaVu is monochrome: color emoji and anything else it
// lacks a glyph for render as a visible □, never '?'.

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseBlocks } from './markdown.js';

// AFM widths (1/1000 em) for chars 32..126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const FONTS = {
  F1: { base: 'Helvetica', widths: HELV },
  F2: { base: 'Helvetica-Bold', widths: HELV_BOLD },
  F3: { base: 'Helvetica-Oblique', widths: HELV },
  F4: { base: 'Courier', widths: null }, // fixed 600
};

// --- Embedded Unicode fallback font (DejaVu Sans, vendored) ---------------
// Minimal TTF reader: only the tables needed for CID embedding — cmap
// (codepoint→gid), hmtx/hhea (advance widths), head (unitsPerEm, bbox),
// maxp (glyph count), OS/2 (cap height). No libraries.

const TTF_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'fonts', 'DejaVuSans.ttf');
const MISSING_GLYPH_CP = 0x25a1; // □ — visible stand-in for glyphs the font lacks

function parseTtf(buf) {
  const tables = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
  }
  for (const t of ['head', 'hhea', 'maxp', 'cmap', 'hmtx']) {
    if (!tables[t]) throw new Error(`font missing required table: ${t}`);
  }

  const head = tables.head.off;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const scale = (v) => Math.round(v * 1000 / unitsPerEm);
  const bbox = [buf.readInt16BE(head + 36), buf.readInt16BE(head + 38), buf.readInt16BE(head + 40), buf.readInt16BE(head + 42)].map(scale);

  const hhea = tables.hhea.off;
  const ascent = scale(buf.readInt16BE(hhea + 4));
  const descent = scale(buf.readInt16BE(hhea + 6));
  const numHMetrics = buf.readUInt16BE(hhea + 34);

  const numGlyphs = buf.readUInt16BE(tables.maxp.off + 4);

  let capHeight = ascent;
  if (tables['OS/2'] && buf.readUInt16BE(tables['OS/2'].off) >= 2) {
    capHeight = scale(buf.readInt16BE(tables['OS/2'].off + 88));
  }

  // cmap: prefer format 12 (full Unicode) then format 4 (BMP).
  const cmap = tables.cmap.off;
  let f4 = 0, f12 = 0;
  const subCount = buf.readUInt16BE(cmap + 2);
  for (let i = 0; i < subCount; i++) {
    const o = cmap + 4 + i * 8;
    const pid = buf.readUInt16BE(o), eid = buf.readUInt16BE(o + 2);
    const sub = cmap + buf.readUInt32BE(o + 4);
    const fmt = buf.readUInt16BE(sub);
    if (fmt === 4 && (pid === 3 && eid === 1 || pid === 0)) f4 = sub;
    if (fmt === 12 && (pid === 3 && eid === 10 || pid === 0)) f12 = sub;
  }
  if (!f4 && !f12) throw new Error('font has no usable Unicode cmap subtable');

  const gidCache = new Map();
  const gidFor = (cp) => {
    if (gidCache.has(cp)) return gidCache.get(cp);
    let gid = 0;
    if (f12) {
      let lo = 0, hi = buf.readUInt32BE(f12 + 12) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = f12 + 16 + mid * 12;
        const start = buf.readUInt32BE(g), end = buf.readUInt32BE(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else { gid = buf.readUInt32BE(g + 8) + (cp - start); break; }
      }
    }
    if (!gid && f4 && cp <= 0xffff) {
      const segCount = buf.readUInt16BE(f4 + 6) / 2;
      const ends = f4 + 14, starts = ends + segCount * 2 + 2;
      const deltas = starts + segCount * 2, ranges = deltas + segCount * 2;
      for (let s = 0; s < segCount; s++) {
        if (cp > buf.readUInt16BE(ends + s * 2)) continue;
        const start = buf.readUInt16BE(starts + s * 2);
        if (cp < start) break;
        const rangeOff = buf.readUInt16BE(ranges + s * 2);
        if (rangeOff === 0) {
          gid = (cp + buf.readInt16BE(deltas + s * 2)) & 0xffff;
        } else {
          const g = buf.readUInt16BE(ranges + s * 2 + rangeOff + (cp - start) * 2);
          gid = g === 0 ? 0 : (g + buf.readInt16BE(deltas + s * 2)) & 0xffff;
        }
        break;
      }
    }
    gidCache.set(cp, gid);
    return gid;
  };

  const hmtx = tables.hmtx.off;
  const widthFor = (gid) => {
    const i = Math.min(gid, numHMetrics - 1);
    return scale(buf.readUInt16BE(hmtx + i * 4));
  };

  return { data: buf, unitsPerEm, bbox, ascent, descent, capHeight, numGlyphs, gidFor, widthFor };
}

let UNI = null;
export function unicodeFont() {
  if (!UNI) UNI = parseTtf(readFileSync(TTF_PATH));
  return UNI;
}

// A string needs the embedded font when any codepoint has no WinAnsi byte.
function needsUnicode(text) {
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 255 && !WINANSI_EXTRA[cp]) return true;
  }
  return false;
}

// Identity-H text: hex string of glyph ids; records gid→codepoint for the
// /W widths array and the ToUnicode CMap. Missing glyphs become □.
function encodeUnicodeHex(text, used) {
  const uni = unicodeFont();
  let hex = '';
  for (const ch of String(text)) {
    let cp = ch.codePointAt(0);
    let gid = uni.gidFor(cp);
    if (!gid) { cp = MISSING_GLYPH_CP; gid = uni.gidFor(cp); }
    if (!used.has(gid)) used.set(gid, cp);
    hex += gid.toString(16).padStart(4, '0');
  }
  return hex;
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;

function charWidth(font, code, size) {
  const f = FONTS[font];
  if (!f.widths) return 600 * size / 1000;
  const w = code >= 32 && code <= 126 ? f.widths[code - 32] : 556;
  return w * size / 1000;
}

function textWidth(font, text, size) {
  if (needsUnicode(text)) {
    // The whole line will render in DejaVu — measure it with DejaVu advances.
    const uni = unicodeFont();
    let w = 0;
    for (const ch of String(text)) {
      const gid = uni.gidFor(ch.codePointAt(0)) || uni.gidFor(MISSING_GLYPH_CP);
      w += uni.widthFor(gid) * size / 1000;
    }
    return w;
  }
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charWidth(font, text.charCodeAt(i), size);
  return w;
}

// Strip markdown inline syntax to plain text for PDF rendering.
export function stripInline(text) {
  return String(text)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

function wrap(font, text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter((w) => w.length);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (textWidth(font, candidate, size) <= maxWidth || !line) {
      line = candidate;
      // Hard-break a single overlong word.
      while (textWidth(font, line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(font, line.slice(0, cut), size) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Typographic characters that exist in WinAnsi but not Latin-1.
const WINANSI_EXTRA = {
  0x20ac: 128, 0x2026: 133, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148,
  0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2122: 153,
};

function escapePdfText(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else if (WINANSI_EXTRA[code]) out += '\\' + WINANSI_EXTRA[code].toString(8).padStart(3, '0');
    else if (code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
    else out += '?'; // unreachable: non-WinAnsi text routes to the embedded font
  }
  return out;
}

class PdfBuilder {
  constructor() {
    this.pages = []; // arrays of content-stream ops
    this.used = new Map(); // gid → codepoint, for the embedded font objects
    this.newPage();
  }

  // One text-showing op. Lines with non-WinAnsi glyphs switch whole to the
  // embedded DejaVu font (/FU) — bold/italic runs in such lines render in
  // DejaVu regular; simpler than per-run splitting and fine at body sizes.
  tj(str, font, size, x, y, rg) {
    const pos = `1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm`;
    if (needsUnicode(str)) {
      return `BT ${rg}/FU ${size} Tf ${pos} <${encodeUnicodeHex(str, this.used)}> Tj ET`;
    }
    return `BT ${rg}/${font} ${size} Tf ${pos} (${escapePdfText(str)}) Tj ET`;
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height) {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(str, { font = 'F1', size = 11, x = MARGIN, color = null, lineGap = 1.35 } = {}) {
    const lh = size * lineGap;
    this.ensure(lh);
    this.y -= lh;
    const rg = color ? `${color.join(' ')} rg ` : '0 0 0 rg ';
    this.ops.push(this.tj(str, font, size, x, this.y, rg));
  }

  paragraph(str, { font = 'F1', size = 11, indent = 0, color = null, gapAfter = 6 } = {}) {
    const lines = wrap(font, str, size, CONTENT_W - indent);
    for (const line of lines) this.text(line, { font, size, x: MARGIN + indent, color });
    this.y -= gapAfter;
  }

  rule() {
    this.ensure(14);
    this.y -= 10;
    this.ops.push(`0.8 0.8 0.8 RG 0.7 w ${MARGIN} ${this.y.toFixed(1)} m ${(PAGE_W - MARGIN).toFixed(1)} ${this.y.toFixed(1)} l S`);
    this.y -= 6;
  }

  space(h) {
    this.y -= h;
  }
}

export function markdownToPdf(markdown, { title = 'Document', subtitle = '' } = {}) {
  const b = new PdfBuilder();

  // Header
  b.paragraph(title, { font: 'F2', size: 20, gapAfter: 2 });
  if (subtitle) b.paragraph(subtitle, { size: 9.5, color: [0.45, 0.45, 0.5], gapAfter: 2 });
  b.rule();
  b.space(6);

  const blocks = parseBlocks(markdown);
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const sizes = { 1: 17, 2: 14.5, 3: 12.5 };
        b.space(8);
        b.paragraph(stripInline(block.text), { font: 'F2', size: sizes[block.level] ?? 11.5, gapAfter: 3 });
        break;
      }
      case 'paragraph':
        b.paragraph(stripInline(block.text.replace(/\n/g, ' ')), {});
        break;
      case 'code': {
        b.space(3);
        for (const line of block.text.split('\n')) {
          for (const wrapped of wrap('F4', line || ' ', 9, CONTENT_W - 12)) {
            b.text(wrapped, { font: 'F4', size: 9, x: MARGIN + 12, color: [0.2, 0.2, 0.3], lineGap: 1.3 });
          }
        }
        b.space(8);
        break;
      }
      case 'quote':
        for (const line of block.text.split('\n')) {
          b.paragraph(stripInline(line), { font: 'F3', size: 11, indent: 16, color: [0.35, 0.35, 0.4], gapAfter: 2 });
        }
        b.space(5);
        break;
      case 'hr':
        b.rule();
        break;
      case 'html':
        // Page-break markers become real PDF page breaks; other raw HTML is skipped.
        if (/class="pagebreak"/.test(block.text)) b.newPage();
        break;
      case 'mermaid': {
        // Diagrams render as their source in PDF (no JS runtime here).
        b.space(3);
        for (const line of block.text.split('\n')) {
          for (const wrapped of wrap('F4', line || ' ', 9, CONTENT_W - 12)) {
            b.text(wrapped, { font: 'F4', size: 9, x: MARGIN + 12, color: [0.2, 0.2, 0.3], lineGap: 1.3 });
          }
        }
        b.space(8);
        break;
      }
      case 'list': {
        let counter = 0;
        for (const item of block.items) {
          counter = item.depth === 0 && item.ordered ? counter + 1 : counter;
          const bullet = item.checked != null ? (item.checked ? '[x]' : '[ ]') : item.ordered ? `${counter}.` : '•';
          b.paragraph(`${bullet} ${stripInline(item.text)}`, { indent: 14 + item.depth * 16, gapAfter: 2 });
        }
        b.space(5);
        break;
      }
      case 'table': {
        const all = [block.header, ...block.rows];
        const colCount = Math.max(...all.map((r) => r.length));
        const widths = [];
        for (let c = 0; c < colCount; c++) {
          widths[c] = Math.max(...all.map((r) => textWidth('F1', stripInline(r[c] ?? ''), 9.5))) + 12;
        }
        const scale = Math.min(1, CONTENT_W / widths.reduce((a, x) => a + x, 0));
        all.forEach((row, ri) => {
          b.ensure(14);
          b.y -= 13;
          let x = MARGIN;
          row.forEach((cell, c) => {
            const font = ri === 0 ? 'F2' : 'F1';
            let text = stripInline(cell ?? '');
            const maxW = widths[c] * scale - 6;
            while (text.length > 1 && textWidth(font, text, 9.5) > maxW) text = text.slice(0, -1);
            b.ops.push(b.tj(text, font, 9.5, x, b.y, '0 0 0 rg '));
            x += widths[c] * scale;
          });
          if (ri === 0) {
            b.y -= 4;
            b.ops.push(`0.75 0.75 0.75 RG 0.7 w ${MARGIN} ${b.y.toFixed(1)} m ${(PAGE_W - MARGIN).toFixed(1)} ${b.y.toFixed(1)} l S`);
          }
        });
        b.space(10);
        break;
      }
    }
  }

  return assemble(b.pages, b.used);
}

// ToUnicode CMap stream body for the used gid→codepoint pairs.
function toUnicodeCMap(used) {
  const pairs = [...used.entries()].sort((a, b) => a[0] - b[0]);
  const chunks = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const slice = pairs.slice(i, i + 100);
    const rows = slice.map(([gid, cp]) => {
      // UTF-16BE units of the codepoint (surrogate pair above the BMP).
      const s = String.fromCodePoint(cp);
      let units = '';
      for (let j = 0; j < s.length; j++) units += s.charCodeAt(j).toString(16).padStart(4, '0');
      return `<${gid.toString(16).padStart(4, '0')}> <${units}>`;
    });
    chunks.push(`${slice.length} beginbfchar\n${rows.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
    chunks.join('\n'),
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

function assemble(pages, used = new Map()) {
  const objects = []; // 1-indexed strings (without "N 0 obj" wrapper)
  const addObj = (body) => objects.push(body) && objects.length;

  const fontIds = {};
  for (const [key, font] of Object.entries(FONTS)) {
    fontIds[key] = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`);
  }
  let fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');

  if (used.size) {
    // Embed the whole vendored TTF (no subsetting — ~750KB, flate-compressed)
    // as a Type0/CIDFontType2 with Identity-H, only when a doc needed it.
    const uni = unicodeFont();
    const fontData = deflateSync(uni.data).toString('latin1');
    const fileId = addObj(`<< /Length ${fontData.length} /Filter /FlateDecode /Length1 ${uni.data.length} >>\nstream\n${fontData}\nendstream`);
    const descId = addObj(`<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 32 /FontBBox [${uni.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${uni.ascent} /Descent ${uni.descent} /CapHeight ${uni.capHeight} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
    const wArr = [...used.keys()].sort((a, b) => a - b).map((gid) => `${gid} [${uni.widthFor(gid)}]`).join(' ');
    const cidId = addObj(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 600 /W [${wArr}] /CIDToGIDMap /Identity >>`);
    const cmapStream = toUnicodeCMap(used);
    const tuId = addObj(`<< /Length ${Buffer.byteLength(cmapStream, 'latin1')} >>\nstream\n${cmapStream}\nendstream`);
    const type0Id = addObj(`<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${tuId} 0 R >>`);
    fontRes += ` /FU ${type0Id} 0 R`;
  }

  const pageIds = [];
  const pagesId = objects.length + pages.length * 2 + 1; // reserved: content+page per page, then Pages
  for (const ops of pages) {
    const stream = ops.join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  const actualPagesId = addObj(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  if (actualPagesId !== pagesId) throw new Error('PDF object id accounting error');
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
