import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
