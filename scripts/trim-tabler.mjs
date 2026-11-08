#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHEET = join(ROOT, 'public/vendor/tabler.min.css');
export const SELECTORS = join(ROOT, 'scripts/tabler-selectors.txt');
const SOURCE_DIRS = ['public', 'src', 'bin'];
const SOURCE_EXT = /\.(js|mjs|html|md)$/;

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === 'vendor' ? [] : walk(p);
  return SOURCE_EXT.test(n) ? [p] : [];
});

export function sourceText(root = ROOT) {
  return SOURCE_DIRS.flatMap((d) => walk(join(root, d))).map((p) => readFileSync(p, 'utf8')).join('\n');
}

const unescape = (s) => s.replace(/\\(.)/g, '$1');

function topLevelSplit(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') { i += 1; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

function outsideParens(selector) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === '\\') { if (!depth) out += selector.slice(i, i + 2); i += 1; continue; }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (!depth) out += c;
  }
  return out;
}

const CLASS = /\.((?:\\.|[\w-])+)/g;

export const requiredClasses = (selector) => [...outsideParens(selector).matchAll(CLASS)].map((m) => unescape(m[1]));


function blocks(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (semi >= 0 && (open < 0 || semi < open) && css.slice(i, semi).trim().startsWith('@')) {
      out.push({ prelude: css.slice(i, semi + 1), body: null });
      i = semi + 1;
      continue;
    }
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    let quote = '';
    for (; j < css.length && depth; j += 1) {
      const c = css[j];
      if (c === '\\') { j += 1; continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    out.push({ prelude: css.slice(i, open), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

const NESTED = /^@(media|supports|container|layer)\b/;

export function trimCss(css, used) {
  let out = '';
  for (const { prelude, body } of blocks(css)) {
    const head = prelude.trim();
    if (body === null) { out += head; continue; }
    if (NESTED.test(head)) {
      const inner = trimCss(body, used);
      if (inner) out += `${head}{${inner}}`;
      continue;
    }
    if (head.startsWith('@')) { out += `${head}{${body}}`; continue; }
    const keep = topLevelSplit(head, ',').filter((s) => requiredClasses(s).every((c) => used.has(c)));
    if (keep.length) out += `${keep.join(',')}{${body}}`;
  }
  return out;
}

export function requirementSets(css) {
  const sets = new Set();
  for (const { prelude, body } of blocks(css)) {
    const head = prelude.trim();
    if (body === null) continue;
    if (NESTED.test(head)) { for (const s of requirementSets(body)) sets.add(s); continue; }
    if (head.startsWith('@')) continue;
    for (const sel of topLevelSplit(head, ',')) {
      const req = [...new Set(requiredClasses(sel))].sort();
      if (req.length) sets.add(req.join(' '));
    }
  }
  return sets;
}

export const classesOf = (sets) => new Set([...sets].flatMap((s) => s.split(' ')));

export function usedTabler(tabler, text = sourceText()) {
  const tokens = new Set(text.split(/[^\w-]+/).filter(Boolean));
  const prefixes = new Set([...text.matchAll(/([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)(?:\$\{|['"`] ?\+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const c of tabler) {
    if (tokens.has(c) || [...prefixes].some((p) => c.startsWith(p))) used.add(c);
  }
  return used;
}

export function banner(css) {
  const end = css.indexOf('*/');
  return css.slice(0, end + 2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const from = process.argv[2];
  if (!from) {
    console.error('usage: node scripts/trim-tabler.mjs <pristine tabler.min.css from @tabler/core 1.4.0>');
    process.exit(2);
  }
  const pristine = readFileSync(from, 'utf8');
  const head = banner(pristine);
  const rules = pristine.slice(head.length).replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '');
  const sets = requirementSets(rules);
  const tabler = classesOf(sets);
  const used = usedTabler(tabler);
  const trimmed = `${head}\n${trimCss(rules, used)}\n`;
  writeFileSync(SHEET, trimmed);
  writeFileSync(SELECTORS, `${[...sets].sort().join('\n')}\n`);
  console.log(`kept ${used.size} of ${tabler.size} classes: ${pristine.length} → ${trimmed.length} bytes`);
}
