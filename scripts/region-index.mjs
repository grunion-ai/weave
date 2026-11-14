#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILES = ['public/app.js', 'src/engine.js'];
export const MAX = 200;
const GRID = 'docs/grid.md';
const OUT = 'docs/regions.md';
const MAP = 'docs/architecture/weave.architecture.json';
const REPO = 'https://github.com/grunion-ai/weave';

const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const IDENT = /[\w$\u0080-\uffff]/;
const OPEN = new Set(['{', '(', '[']);
const CLOSE = new Set(['}', ')', ']']);

const pin = () => JSON.parse(readFileSync(join(ROOT, MAP), 'utf8')).meta.repository.revision;
export const inTree = (root = ROOT) => (path) => readFileSync(join(root, path), 'utf8');
export const atRevision = (rev) => (path) => {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`cannot read ${path} at ${rev}: run git fetch origin main and retry (${String(err.stderr ?? err.message).trim()})`);
  }
};

function scan(src) {
  const states = [{ depth: 0, quoted: false }];
  let mode = src.startsWith('#!') ? 'line' : 'code';
  let depth = 0, prev = '', word = '', inWord = false, escaped = false, cls = false;
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') {
      if (mode === 'line' || mode === 'regex' || ((mode === 'single' || mode === 'double') && !escaped)) mode = 'code';
      escaped = false;
      inWord = false;
      states.push({ depth, quoted: mode !== 'code' });
      continue;
    }
    if (mode === 'line') continue;
    if (mode === 'block') {
      if (c === '*' && src[i + 1] === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode !== 'code') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"')) { mode = 'code'; prev = ')'; word = ''; }
      else if (mode === 'template' && c === '`') { mode = 'code'; prev = ')'; word = ''; }
      else if (mode === 'template' && c === '$' && src[i + 1] === '{') { stack.push('tpl'); depth++; mode = 'code'; prev = '{'; word = ''; i++; }
      else if (mode === 'regex') {
        if (c === '[') cls = true;
        else if (c === ']') cls = false;
        else if (c === '/' && !cls) { mode = 'code'; prev = ')'; word = ''; }
      }
      continue;
    }
    if (IDENT.test(c)) { word = inWord ? word + c : c; inWord = true; prev = 'a'; continue; }
    inWord = false;
    if (c === ' ' || c === '\t' || c === '\r') continue;
    const d = src[i + 1];
    if (c === '/' && d === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && d === '*') { mode = 'block'; i++; continue; }
    if (c === "'") { mode = 'single'; continue; }
    if (c === '"') { mode = 'double'; continue; }
    if (c === '`') { mode = 'template'; continue; }
    if (c === '/' && (prev === '' || REGEX_AFTER.has(prev) || REGEX_WORDS.has(word))) { mode = 'regex'; cls = false; continue; }
    if ((c === '+' || c === '-') && d === c) { i++; prev = ')'; word = ''; continue; }
    if (OPEN.has(c)) { stack.push(c); depth++; }
    else if (CLOSE.has(c)) {
      depth--;
      if (stack.pop() === 'tpl') { mode = 'template'; continue; }
    }
    prev = c;
    word = '';
  }
  const lines = src.split('\n');
  if (src.endsWith('\n')) lines.pop();
  return { lines, states };
}

const SKIP = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'try', 'function', 'await', 'new', 'typeof', 'super']);
const NAMERS = {
  scope: [
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/,
    /^(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/,
    /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/,
    /^(?:globalThis|window|self|root)\.([\w$]+)\s*=(?!=)/,
  ],
  class: [
    /^(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?\s*(#?[\w$]+)\s*\(/,
    /^(?:static\s+)?(#?[\w$]+)\s*(?:=(?!=)|;)/,
  ],
  object: [
    /^(?:async\s+)?(?:get\s+|set\s+)?\*?\s*([\w$]+)\s*\(/,
    /^['"]?([\w$-]+)['"]?\s*:/,
  ],
};
const FN = /^(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\b|class\b|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?(?:function\b|\(.*\)\s*=>|[\w$]+\s*=>|\($))/;

function namesOf(head, kind) {
  if (kind === 'scope') {
    const parts = head.match(/^(?:export\s+)?(?:const|let|var)\s+[{[]([^\]}]*)[\]}]/);
    if (parts) return parts[1].split(',').map((p) => p.trim().split(/\s*[:=]\s*/).pop().replace(/^\.\.\./, '')).filter((n) => /^[\w$]+$/.test(n));
  }
  for (const re of NAMERS[kind]) {
    const m = head.match(re);
    if (m && !SKIP.has(m[1])) return [m[1]];
  }
  return [];
}

const kindOf = (head) => (/^(?:export\s+)?(?:default\s+)?class\b[^=]*\{$/.test(head) ? 'class'
  : /(?:[=:(,?]|\breturn)\s*\{$/.test(head) ? 'object' : 'scope');

function outline(src) {
  const { lines, states } = scan(src);
  const indent = (l) => l.length - l.trimStart().length;
  const items = (from, to, depth, col, kind) => {
    const starts = [];
    for (let n = from; n <= to; n++) {
      const l = lines[n];
      if (!l.trim() || states[n].quoted || states[n].depth !== depth || indent(l) !== col || CLOSE.has(l.trimStart()[0])) continue;
      starts.push(n);
    }
    return starts.map((s, k) => {
      let e = (k + 1 < starts.length ? starts[k + 1] : to + 1) - 1;
      while (e > s && !lines[e].trim()) e--;
      const head = lines[s].trim();
      return { start: s, end: e, kind, head, names: namesOf(head, kind), fn: kind !== 'scope' || FN.test(head), children: e > s ? items(s + 1, e, states[s + 1].depth, col + 2, kindOf(head)) : [] };
    });
  };
  return { lines, top: items(0, lines.length - 1, 0, 0, 'scope') };
}

const unique = (list) => [...new Set(list)];

export function regions(src) {
  const { lines, top } = outline(src);
  const out = [];
  const pack = (list, from, to, path) => {
    let cur = null;
    const flush = () => { if (cur) out.push(cur); cur = null; };
    list.forEach((it, k) => {
      const s = k === 0 ? from : it.start;
      const e = k === list.length - 1 ? to : list[k + 1].start - 1;
      if (e - s + 1 > MAX) {
        flush();
        const inside = [...path, ...it.names.slice(0, 1)];
        if (it.children.length > 1) pack(it.children, s, e, inside);
        else for (let a = s; a <= e; a += MAX) out.push({ start: a, end: Math.min(e, a + MAX - 1), path: inside, names: [] });
        return;
      }
      if (cur && e - cur.start + 1 > MAX) flush();
      cur ??= { start: s, end: e, path, names: [] };
      cur.end = e;
      if (!path.length || it.fn) cur.names.push(...it.names);
    });
    flush();
  };
  pack(top, 0, lines.length - 1, []);
  return out.map((r) => ({ start: r.start + 1, end: r.end + 1, path: r.path, names: unique(r.names) }));
}

function declarations(src) {
  const out = [];
  const walk = (list, path) => {
    for (const it of list) {
      out.push({ start: it.start + 1, end: it.end + 1, names: it.names, path });
      walk(it.children, [...path, ...it.names.slice(0, 1)]);
    }
  };
  walk(outline(src).top, []);
  return out;
}

const lineCount = (src) => src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
const gridRows = (doc) => doc.split('\n')
  .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\|\s*Behaviour\s*\|/.test(l))
  .map((l) => {
    const [, behaviour, where = ''] = l.split('|');
    return { behaviour: behaviour.trim(), tokens: [...where.matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });

export function gridIndex(read) {
  const rows = gridRows(read(GRID));
  const gridFiles = unique(rows.flatMap((r) => r.tokens.filter((t) => t.includes('/')))).filter((f) => !FILES.includes(f));
  const memo = new Map();
  const decls = (file) => {
    if (!memo.has(file)) memo.set(file, declarations(read(file)));
    return memo.get(file);
  };
  const owners = (owner) => gridFiles.filter((f) => decls(f).some((d) => d.names.includes(owner)));
  return rows.map(({ behaviour, tokens }) => {
    const files = tokens.filter((t) => t.includes('/'));
    const cited = tokens.filter((t) => !t.includes('/') && !t.includes(' ') && !t.startsWith('wv-'));
    const bare = cited.map((t) => t.split('.').pop());
    const spans = files.filter((f) => !FILES.includes(f)).map((f) => ({ token: f, name: f, file: f, start: 1, end: lineCount(read(f)), path: [], whole: true }));
    for (const token of cited) {
      const dot = token.lastIndexOf('.');
      const name = token.slice(dot + 1);
      const order = dot > 0 ? owners(token.slice(0, dot)) : unique(['public/app.js', ...files.filter((f) => !FILES.includes(f)), ...gridFiles]);
      for (const file of order) {
        const found = decls(file).filter((d) => d.names.includes(name));
        if (!found.length) continue;
        const top = found.filter((d) => !d.path.length);
        const direct = found.filter((d) => bare.includes(d.path.at(-1)));
        const inside = found.filter((d) => d.path.some((p) => bare.includes(p)));
        const hits = [top, direct, inside, found.length === 1 ? found : []].find((list) => list.length) ?? [];
        for (const d of hits) spans.push({ token, name, file, start: d.start, end: d.end, path: d.path, whole: false });
        break;
      }
    }
    const covered = (s) => !s.whole && spans.some((w) => w.whole && w.file === s.file);
    return { behaviour, cited, spans: spans.filter((s) => !covered(s)) };
  });
}

const code = (v) => `\`${v}\``;
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ',');

function spanText(s, appRegions) {
  if (s.whole) return `${code(s.file)} ${s.start}-${s.end}`;
  const where = s.file === 'public/app.js' ? '' : ` ${s.file}`;
  const inside = s.path.length && s.token === s.name ? ` in ${s.path.map(code).join(' › ')}` : '';
  const size = s.end - s.start + 1;
  const parts = size > MAX && !where && !s.path.length ? appRegions.filter((r) => r.path[0] === s.name).length : 0;
  const note = size > MAX ? ` (${thousands(size)} lines${parts ? `, ${parts} regions below` : ''})` : '';
  return `${code(s.token)}${where} ${s.start}-${s.end}${inside}${note}`;
}

function regionText(r) {
  const names = r.names.map(code).join(', ');
  if (!r.path.length) return names || 'top-level statements';
  const path = r.path.map(code).join(' › ');
  return names ? `in ${path}: ${names}` : `in ${path}`;
}

export function render(read, revision) {
  const sources = Object.fromEntries(FILES.map((f) => [f, read(f)]));
  const cut = Object.fromEntries(FILES.map((f) => [f, regions(sources[f])]));
  const sizes = FILES.map((f) => `${code(f)} (${thousands(lineCount(sources[f]))} lines)`).join(' and ');
  const from = revision
    ? `\`node scripts/region-index.mjs\` generates this page at commit [\`${revision.slice(0, 7)}\`](${REPO}/tree/${revision}), the commit the [architecture map](architecture/README.md) pins, so every line number is a line at that commit, and \`node scripts/architecture.mjs\` rewrites the page each time it re-pins the map. Code merged since the pin can shift a range by a few lines: \`node scripts/region-index.mjs --now\` prints these tables for your checkout. \`test/region-index.test.mjs\` fails when this page differs from what the script renders at the pin.`
    : 'These tables come from your checkout (`node scripts/region-index.mjs --now`). The committed page, docs/regions.md, holds the lines at the architecture map pin.';
  const grid = gridIndex(read).map((row) => {
    const where = row.spans.length ? row.spans.map((s) => spanText(s, cut['public/app.js'])).join(', ') : `no declaration to place: ${row.cited.map(code).join(', ') || 'see the grid map'}`;
    return `| ${row.behaviour} | ${where} |`;
  });
  const tables = FILES.flatMap((f) => [
    '',
    `## ${f}`,
    '',
    '| Lines | Declares |',
    '| --- | --- |',
    ...cut[f].map((r) => `| ${r.start}-${r.end} | ${regionText(r)} |`),
  ]);
  return [
    '# Region index',
    '',
    `${sizes} are too long to read whole. This page cuts each one into regions of at most ${MAX} lines along its declarations and names what every region declares, so a change opens the right ${MAX} lines first. The first table places each behaviour of the [grid map](grid.md) by line.`,
    '',
    from,
    '',
    '## Grid behaviours',
    '',
    `A name with no file is in \`public/app.js\`, and "in" names the function a declaration sits inside.`,
    '',
    '| Behaviour | Lines |',
    '| --- | --- |',
    ...grid,
    ...tables,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--now')) {
    process.stdout.write(render(inTree(), null));
  } else {
    const revision = pin();
    writeFileSync(join(ROOT, OUT), render(atRevision(revision), revision));
    console.log(`${OUT} rendered at ${revision.slice(0, 7)}`);
  }
}
