#!/usr/bin/env node
/* docs/chip-card-anatomy.html — the "Chip and card anatomy" Handbook guide
   as ONE self-contained page (Feature #180), for sharing outside the app.

   The guide's figures are the real chip and card markup, so the page needs
   the real chip CSS to draw them. Rather than a hand-kept copy that drifts,
   this lifts the chip rules out of public/style.css by selector (every rule
   whose selector list touches .k, .av, .hue-*, .mention-*, .wv-card*, the
   two chip tokens on :root, and their [data-bs-theme="dark"] twins) and
   inlines them after the document page's own stylesheet. The Tabler tokens
   those rules read are declared here for both themes, so the page follows
   prefers-color-scheme with no framework attached.

   No network requests: the favicon link the document page carries is
   dropped, and the guide has no code fence, diagram or math, so no vendor
   script is emitted. test/handbook.test.mjs re-runs this with --stdout and
   fails when docs/chip-card-anatomy.html no longer matches.

     node scripts/export-chip-card-anatomy.mjs            # writes the file
     node scripts/export-chip-card-anatomy.mjs --stdout   # prints it */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GUIDES } from '../src/handbook.js';
import { renderDocumentPage } from '../src/markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'chip-card-anatomy.html');
const CHIP_SELECTORS = /^(:root|\.k\b|\.k-|\.k\.|\.av\b|\.hue-|\.mention-|\.wv-card|\.wv-seg-state|\[data-bs-theme="dark"\] \.(k|hue|av))/;

/* Every top-level rule block in style.css whose selector list has a part
   the chip needs. Comments go first so a note above a rule is not read as
   part of its selector. */
export function chipCss(css = readFileSync(join(ROOT, 'public/style.css'), 'utf8')) {
  const out = [];
  for (const [, sels, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = sels.split(',').map((s) => s.trim()).filter(Boolean);
    const keep = parts.filter((p) => CHIP_SELECTORS.test(p));
    if (!keep.length) continue;
    // :root carries the whole theme; only the two chip tokens ride along.
    const decls = keep.some((p) => p.startsWith(':root'))
      ? body.split(';').filter((d) => /--wv-chip-/.test(d)).join(';')
      : body.trim();
    if (!decls.trim()) continue;
    out.push(`${keep.join(', ')} { ${decls.replace(/\s+/g, ' ').trim()}${decls.trim().endsWith(';') ? '' : ';'} }`);
  }
  return out.join('\n');
}

/* The Tabler tokens the chip rules read, in weave's own values
   (public/style.css :root and [data-bs-theme="dark"]), keyed off the
   viewer's colour scheme and off data-bs-theme so either wins. */
const TOKENS = `
:root, [data-bs-theme="light"] {
  --tblr-border-color: #e6e3dc; --tblr-body-color: #1a1d23; --tblr-secondary: #6b7280;
  --tblr-primary: #2563eb; --tblr-primary-rgb: 37, 99, 235; --tblr-danger: #d63939;
  --tblr-bg-surface: #fafaf8; --tblr-bg-surface-secondary: #f3f1ec;
  --tblr-font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-bs-theme="light"]) {
    --tblr-border-color: #2c3a52; --tblr-body-color: #e0dcd4; --tblr-secondary: #9aa3b5;
    --tblr-primary: #4f8df7; --tblr-primary-rgb: 79, 141, 247; --tblr-danger: #ff6b6b;
    --tblr-bg-surface: #16243d; --tblr-bg-surface-secondary: #1c2c48;
  }
}
[data-bs-theme="dark"] {
  --tblr-border-color: #2c3a52; --tblr-body-color: #e0dcd4; --tblr-secondary: #9aa3b5;
  --tblr-primary: #4f8df7; --tblr-primary-rgb: 79, 141, 247; --tblr-danger: #ff6b6b;
  --tblr-bg-surface: #16243d; --tblr-bg-surface-secondary: #1c2c48;
}
/* The figures sit on the page's own ground; tables keep the app's density. */
body { font-size: 15px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
.wv-anat { background: var(--soft); }
`;

export function exportAnatomy() {
  const guide = GUIDES.find((g) => g.name === 'Chip and card anatomy');
  if (!guide) throw new Error('no "Chip and card anatomy" guide in src/handbook.js');
  const resolveMention = (kind, ref) => (kind === 'table' ? { href: '#fields', label: ref.split('/').pop() } : null);
  const page = renderDocumentPage({ title: guide.name, subtitle: 'Handbook · Guide', markdown: guide.doc, resolveMention });
  return page
    .replace(/<link rel="icon"[^>]*>\n?/, '')
    .replace('</style>', `</style>\n<style>\n/* weave chip system, lifted from public/style.css */\n${chipCss()}\n${TOKENS}</style>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = exportAnatomy();
  if (process.argv.includes('--stdout')) process.stdout.write(html);
  else { writeFileSync(OUT, html); console.log(`wrote ${OUT} (${html.length} bytes)`); }
}
