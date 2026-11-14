import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, MAX, regions, gridIndex, render, atRevision, inTree } from '../scripts/region-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const PIN = JSON.parse(read('docs/architecture/weave.architecture.json')).meta.repository.revision;
const tree = inTree(ROOT);

const section = (doc, heading) => {
  const start = doc.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const level = heading.match(/^#+/)[0].length;
  const rest = doc.slice(start + 1);
  const next = [...rest.matchAll(/\n(#+) /g)].find((m) => m[1].length <= level);
  return next ? rest.slice(0, next.index + 1) : rest;
};
const REPO_MAP = section(read('AGENTS.md'), '### Repo map') ?? '';
const gridBehaviours = () => read('docs/grid.md').split('\n')
  .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\|\s*Behaviour\s*\|/.test(l))
  .map((l) => l.split('|')[1].trim());

test('docs/regions.md is the index scripts/region-index.mjs renders at the architecture map pin (Issue #1589)', () => {
  assert.ok(existsSync(join(ROOT, 'docs/regions.md')), 'docs/regions.md is missing: run node scripts/region-index.mjs');
  assert.equal(read('docs/regions.md'), render(atRevision(PIN), PIN),
    `docs/regions.md is stale for the architecture map pin ${PIN.slice(0, 7)}: run node scripts/region-index.mjs`);
});

test('the regions tile app.js and engine.js in windows of at most 200 lines (Issue #1589)', () => {
  assert.deepEqual(FILES, ['public/app.js', 'src/engine.js']);
  assert.equal(MAX, 200);
  for (const file of FILES) {
    const src = read(file);
    const total = src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
    const list = regions(src);
    assert.equal(list[0].start, 1, `${file}: the first region starts at line 1`);
    assert.equal(list.at(-1).end, total, `${file}: the last region ends at line ${total}`);
    list.forEach((r, i) => {
      assert.ok(r.end - r.start + 1 <= MAX, `${file} ${r.start}-${r.end} is longer than ${MAX} lines`);
      if (i) assert.equal(r.start, list[i - 1].end + 1, `${file}: the region after ${list[i - 1].end} starts at ${r.start}`);
    });
  }
});

test('each region names the functions it holds (Issue #1589)', () => {
  const engine = read('src/engine.js').split('\n');
  const classAt = engine.findIndex((l) => l.startsWith('export class Weave '));
  const checks = [
    ['public/app.js', 0, /^(?:async )?function\*? ?([\w$]+)\(/],
    ['src/engine.js', classAt, /^ {2}(?:static )?(?:async )?(?:get |set )?\*?(#?[\w$]+)\([^)]*\) \{$/],
  ];
  for (const [file, from, re] of checks) {
    const src = read(file);
    const list = regions(src);
    let seen = 0;
    src.split('\n').forEach((line, i) => {
      const m = i >= from && line.match(re);
      if (!m) return;
      seen++;
      const r = list.find((x) => x.start <= i + 1 && i + 1 <= x.end);
      assert.ok([...r.path, ...r.names].includes(m[1]), `${file}: ${m[1]} at line ${i + 1} is named by its region ${r.start}-${r.end}`);
    });
    assert.ok(seen > 200, `${file}: ${seen} functions checked`);
  }
});

test('every grid behaviour of docs/grid.md is a row of lines in the index (Issue #1589)', () => {
  const rows = gridIndex(tree);
  assert.deepEqual(rows.map((r) => r.behaviour), gridBehaviours());
  const app = read('public/app.js');
  const appLines = app.split('\n');
  for (const r of rows) {
    for (const s of r.spans.filter((x) => !x.whole)) {
      const head = read(s.file).split('\n')[s.start - 1];
      assert.ok(head.includes(s.name), `${s.file}:${s.start} declares ${s.name} (${r.behaviour})`);
    }
    for (const name of r.cited.filter((n) => /^[\w$]+$/.test(n))) {
      const word = name.replaceAll('$', '\\$');
      const at = appLines.flatMap((l, i) => (new RegExp(`^(?:async )?function ${word}\\(|^(?:const|let) ${word} =`).test(l) ? [i + 1] : []));
      if (at.length !== 1) continue;
      assert.ok(r.spans.some((s) => s.file === 'public/app.js' && s.name === name && s.start === at[0]), `${r.behaviour} places ${name} at public/app.js:${at[0]}`);
    }
  }
});

test('an agent finds the 200 lines for a grid behaviour from one table (Issue #1589)', () => {
  const row = gridIndex(tree).find((r) => r.behaviour === 'Focus and scroll survive a redraw');
  assert.deepEqual(row.spans.map((s) => s.name).sort(), ['keepScroll', 'rememberGridFocus', 'restoreGridFocus']);
  const lines = row.spans.reduce((n, s) => n + s.end - s.start + 1, 0);
  assert.ok(lines <= MAX, `the behaviour's code is ${lines} lines`);
  const doc = render(tree, null);
  const line = doc.split('\n').find((l) => l.startsWith('| Focus and scroll survive a redraw |'));
  assert.ok(line, 'the grid table has a row for the behaviour');
  for (const s of row.spans) assert.ok(line.includes(`\`${s.name}\` ${s.start}-${s.end}`), `the row gives ${s.name} ${s.start}-${s.end}: ${line}`);
});

test('the repo map names every bin script, src module and public/ entry (Issue #1589)', () => {
  const listed = (dir, keep) => readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && keep(d))
    .map((d) => `${dir}/${d.name}${d.isDirectory() ? '/' : ''}`);
  const want = [
    ...listed('bin', (d) => d.name.endsWith('.js')),
    ...listed('src', (d) => d.isDirectory() || d.name.endsWith('.js')),
    ...listed('public', () => true),
  ];
  assert.ok(want.length > 120, `${want.length} entries`);
  const missing = want.filter((p) => !REPO_MAP.includes('`' + p + '`'));
  assert.deepEqual(missing, [], 'AGENTS.md repo map: add each to the row for its area');
});

test('every path and link in the repo map resolves (Issue #1589)', () => {
  const named = [...REPO_MAP.matchAll(/`((?:bin|src|public|test|docs|scripts)\/[^`\s]*)`/g)].map((m) => m[1]);
  assert.ok(named.length > 120, `${named.length} paths named`);
  assert.deepEqual(named.filter((p) => !existsSync(join(ROOT, p))), [], 'the repo map names paths that moved or were deleted');
  const links = [...REPO_MAP.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)].map((m) => m[1]).filter((p) => !/^https?:/.test(p));
  assert.ok(links.length, 'the repo map links the docs to read first');
  assert.deepEqual(links.filter((p) => !existsSync(join(ROOT, p))), [], 'the repo map links docs that do not exist');
});

test('the repo map sends app.js and engine.js to the region index and the grid cores to the grid map (Issue #1589)', () => {
  const row = (path) => REPO_MAP.split('\n').find((l) => l.startsWith('| ') && l.includes('`' + path + '`')) ?? '';
  for (const file of FILES) assert.match(row(file), /\]\(docs\/regions\.md\)/, `the ${file} row links docs/regions.md`);
  assert.match(row('public/grid-window.js'), /\]\(docs\/grid\.md\)/, 'the grid cores row links docs/grid.md');
  assert.match(read('docs/architecture/README.md'), /node scripts\/region-index\.mjs/, 'a re-pin regenerates the region index');
});
