#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GUIDES } from '../src/handbook.js';
import { renderDocumentPage } from '../src/markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'chip-card-anatomy.html');
const CHIP_SELECTORS = /^(:root|\.k\b|\.k-|\.k\.|\.av\b|\.hue-|\.mention|\.wv-card|\.wv-prose|\.cg-|\.wv-rat|\[data-bs-theme="dark"\] \.(k|hue|av))/;

function selectorList(sels) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < sels.length; i += 1) {
    const c = sels[i];
    if (quote) {
      if (c === quote && sels[i - 1] !== '\\') quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(' || c === '[') {
      depth += 1;
    } else if (c === ')' || c === ']') {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      parts.push(sels.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(sels.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p && !p.startsWith('@'));
}

export function cssRules(css, at = []) {
  const src = at.length ? css : css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).replace(/\s+/g, ' ').trim();
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
    }
    const inner = src.slice(open + 1, j - 1);
    if (/^@(media|container|supports)\b/.test(prelude)) out.push(...cssRules(inner, [...at, prelude]));
    else if (!prelude.startsWith('@')) out.push({ at, sels: prelude, body: inner });
    i = j;
  }
  return out;
}

export function scoped(at, rule) {
  return at.reduceRight((inner, cond) => `${cond} { ${inner} }`, rule);
}

export function chipCss(css = [readFileSync(join(ROOT, 'public/chip.css'), 'utf8'), readFileSync(join(ROOT, 'public/style.css'), 'utf8')].join('\n')) {
  const out = [];
  for (const { at, sels, body } of cssRules(css)) {
    const parts = selectorList(sels);
    const keep = parts.filter((p) => CHIP_SELECTORS.test(p));
    if (!keep.length) continue;
    const decls = keep.some((p) => p.startsWith(':root'))
      ? body.split(';').filter((d) => /--wv-chip-|--fs-/.test(d)).join(';')
      : body.trim();
    if (!decls.trim()) continue;
    out.push(scoped(at, `${keep.join(', ')} { ${decls.replace(/\s+/g, ' ').trim()}${decls.trim().endsWith(';') ? '' : ';'} }`));
  }
  return out.join('\n');
}

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
    .replace(/<link rel="(icon|stylesheet)"[^>]*>\n?/g, '')
    .replace('</style>', `</style>\n<style>\n${chipCss()}\n${TOKENS}</style>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = exportAnatomy();
  if (process.argv.includes('--stdout')) process.stdout.write(html);
  else { writeFileSync(OUT, html); console.log(`wrote ${OUT} (${html.length} bytes)`); }
}
