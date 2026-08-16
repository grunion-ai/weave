// Zero-dependency PDF generator: renders an entity's markdown document to a
// valid, viewable PDF (US Letter). Uses the 14 standard PDF fonts, so no font
// embedding is needed. Text is wrapped with real Helvetica AFM metrics.

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
    else out += '?'; // no WinAnsi glyph
  }
  return out;
}

class PdfBuilder {
  constructor() {
    this.pages = []; // arrays of content-stream ops
    this.newPage();
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
    this.ops.push(`BT ${rg}/${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${this.y.toFixed(1)} Tm (${escapePdfText(str)}) Tj ET`);
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
            b.ops.push(`BT 0 0 0 rg /${font} 9.5 Tf 1 0 0 1 ${x.toFixed(1)} ${b.y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`);
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

  return assemble(b.pages);
}

function assemble(pages) {
  const objects = []; // 1-indexed strings (without "N 0 obj" wrapper)
  const addObj = (body) => objects.push(body) && objects.length;

  const fontIds = {};
  for (const [key, font] of Object.entries(FONTS)) {
    fontIds[key] = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`);
  }
  const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');

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
