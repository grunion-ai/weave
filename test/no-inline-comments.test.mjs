import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIRS = ['src', 'bin', 'scripts', 'test', 'public'];
const SKIP_DIRS = new Set(['vendor', 'node_modules', 'brand']);
const ALLOWED = new Map();
const RULE = 'weave has no inline code comments (Issue #661). Delete the comment; put the why in the commit message, the Issue or Feature row, or docs/.';

const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
const IDENT = /[\w$\u0080-\uffff]/;

const lineAt = (src) => {
  const starts = [0];
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return (k) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= k) lo = mid; else hi = mid - 1; } return lo + 1; };
};

export function jsComments(src) {
  const at = [];
  const stack = [];
  let i = src.startsWith('#!') ? src.indexOf('\n') : 0;
  let prev = '', word = '';
  let inTemplate = false;
  if (i < 0) return at;
  while (i < src.length) {
    if (inTemplate) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { inTemplate = false; i++; prev = ')'; word = ''; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('tpl'); inTemplate = false; i += 2; prev = '{'; word = ''; continue; }
      i++; continue;
    }
    const c = src[i], d = src[i + 1];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && d === '/') { at.push(i); const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (c === '/' && d === '*') { at.push(i); const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i++; prev = ')'; word = ''; continue;
    }
    if (c === '`') { inTemplate = true; i++; continue; }
    if (c === '/' && (prev === '' || REGEX_AFTER.has(prev) || REGEX_WORDS.has(word))) {
      i++;
      let cls = false;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        i++;
      }
      i++;
      while (IDENT.test(src[i] || '')) i++;
      prev = ')'; word = ''; continue;
    }
    if (IDENT.test(c)) { const s = i; while (i < src.length && IDENT.test(src[i])) i++; word = src.slice(s, i); prev = 'a'; continue; }
    if ((c === '+' || c === '-') && d === c) { i += 2; prev = ')'; word = ''; continue; }
    if (c === '{') stack.push('{');
    if (c === '}' && stack.pop() === 'tpl') { inTemplate = true; i++; continue; }
    prev = c; word = ''; i++;
  }
  return at;
}

export function cssComments(src) {
  const at = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { at.push(i); const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    i++;
  }
  return at;
}

export function htmlComments(src) {
  const at = [];
  const re = /<!--[\s\S]*?-->|(<script\b[^>]*>)([\s\S]*?)<\/script>|(<style\b[^>]*>)([\s\S]*?)<\/style>/gi;
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) { if (!/\bsrc=/.test(m[1])) for (const k of jsComments(m[2])) at.push(m.index + m[1].length + k); }
    else if (m[3] !== undefined) for (const k of cssComments(m[4])) at.push(m.index + m[3].length + k);
    else at.push(m.index);
  }
  return at;
}

const SCAN = { '.js': jsComments, '.mjs': jsComments, '.css': cssComments, '.html': htmlComments };

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out); }
    else if (SCAN[extname(e.name)]) out.push(join(dir, e.name));
  }
  return out;
}

export function findComments(root = ROOT, dirs = DIRS) {
  const hits = [];
  for (const d of dirs) for (const abs of walk(join(root, d), [])) {
    const file = relative(root, abs).split('\\').join('/');
    const src = readFileSync(abs, 'utf8');
    const line = lineAt(src);
    for (const k of SCAN[extname(abs)](src)) {
      const where = `${file}:${line(k)}`;
      if (!ALLOWED.has(where)) hits.push(where);
    }
  }
  return hits;
}

test('the scanner finds comments and skips strings, templates and regex literals', () => {
  assert.equal(jsComments('#!/usr/bin/env node\nconst a = 1;\n').length, 0, 'a shebang is not a comment');
  assert.equal(jsComments("const u = 'http://x'; const t = `/* ${'//'} */`; const r = /\\/\\/[/*]/g;").length, 0);
  assert.equal(jsComments('const r = a.split(/\\//); const q = x / y / z;').length, 0);
  assert.equal(jsComments('const t = `a ${ {b: `//`}.b } c`; return /* x */ 1;').length, 1);
  assert.equal(jsComments('x = 1; // trailing\n/* block */\n').length, 2);
  assert.equal(cssComments('a { background: url("x/*y*/z"); } /* note */').length, 1);
  assert.equal(htmlComments('<!-- note --><script>const a = 1; // x\n</script><style>a{} /* y */</style>').length, 3);
});

test('first-party code carries no inline comments', () => {
  const hits = findComments();
  assert.deepEqual(hits, [], `${RULE}\n${hits.length} comment(s):\n${hits.slice(0, 50).join('\n')}${hits.length > 50 ? '\n…' : ''}`);
});
