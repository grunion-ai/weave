import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const DOC = 'docs/graph.md';
const GRAPH = 'graphify-out/graph.json';

const graph = () => JSON.parse(read(GRAPH));
const ignored = () => read('.graphifyignore').split('\n').map((l) => l.trim()).filter((l) => l.endsWith('/'));
const rows = () => read(DOC).split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l));
const cited = (row) => [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const FILE = /^(src|public|bin|scripts|test)\/[\w./-]+\.(m?js|html)$/;
const FN = /^#?[A-Za-z_$][\w$]*\(\)$/;

test('the committed code graph loads and names the commit it describes', () => {
  assert.ok(existsSync(join(ROOT, GRAPH)), `${GRAPH} is the graph agents query`);
  const g = graph();
  assert.ok(g.nodes.length > 5000, `the graph covers the codebase, found ${g.nodes.length} nodes`);
  assert.ok(g.links.length > g.nodes.length, 'the graph carries its edges');
  assert.match(g.built_at_commit ?? '', /^[0-9a-f]{40}$/, 'graph.json names the commit it was built from');
  assert.ok(existsSync(join(ROOT, 'graphify-out/GRAPH_REPORT.md')), 'the report ships beside the graph');
});

test('the code graph leaves out every path .graphifyignore excludes', () => {
  const dirs = ignored();
  assert.ok(dirs.includes('public/vendor/') && dirs.includes('src/vendor/'), 'vendored code stays out of the graph');
  const leaked = graph().nodes.map((n) => n.source_file ?? '').filter((f) => dirs.some((d) => f.startsWith(d)));
  assert.deepEqual([...new Set(leaked)], [], 'rebuild with graphify after changing .graphifyignore');
});

test('the code graph communities carry names, not placeholders', () => {
  const names = new Set(graph().nodes.map((n) => n.community_name).filter(Boolean));
  const placeholders = [...names].filter((n) => /^Community \d+$/.test(n));
  assert.ok(placeholders.length <= names.size / 10, `${placeholders.length} of ${names.size} communities are unnamed: run graphify label`);
});

test('every file the graph doc cites is in the repo', () => {
  const files = new Set(rows().flatMap(cited).filter((n) => FILE.test(n)));
  assert.ok(files.size >= 8, `${DOC} places the browser layer, found ${files.size} files`);
  const missing = [...files].filter((f) => !existsSync(join(ROOT, f)));
  assert.deepEqual(missing, [], `${DOC} cites files that moved or were deleted`);
});

test('every function the graph doc cites is defined in a file its row names', () => {
  const misses = [];
  for (const row of rows()) {
    const names = cited(row);
    const files = names.filter((n) => FILE.test(n.split(':')[0])).map((n) => n.split(':')[0]);
    if (!files.length) continue;
    const text = files.map(read).join('\n');
    for (const fn of names.filter((n) => FN.test(n))) {
      const name = fn.slice(0, -2).replace(/[$]/g, '\\$');
      if (!new RegExp(`(function\\s*\\*?\\s*${name}\\b|\\b${name}\\s*[:=]\\s*(async\\s*)?(function|\\(|[\\w$]+\\s*=>)|^\\s*(async\\s+)?${name}\\s*\\()`, 'm').test(text)) misses.push(`${fn} in ${files.join(', ')}`);
    }
  }
  assert.deepEqual(misses, [], `${DOC} cites functions its rows do not define`);
});
