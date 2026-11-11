import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const MAP = 'docs/grid.md';

const rows = () => read(MAP).split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\|\s*Behaviour\s*\|/.test(l));
const cited = (row) => [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('every row of the grid map names a behaviour and where it lives (Issue #1695)', () => {
  assert.ok(existsSync(join(ROOT, MAP)), `${MAP} is the map a grid change starts from`);
  const all = rows();
  assert.ok(all.length >= 20, `the map covers the grid, found ${all.length} rows`);
  for (const row of all) {
    const [, behaviour, where] = row.split('|');
    assert.ok(behaviour.trim().length > 8, `a row says which behaviour it places: ${row}`);
    assert.ok(cited(row).length, `a row names at least one function, file or class: ${row}`);
    assert.ok(where.trim().length, `a row has a where: ${row}`);
  }
});

test('every file the grid map cites is in the repo (Issue #1695)', () => {
  const files = new Set();
  for (const row of rows()) for (const name of cited(row)) if (name.includes('/')) files.add(name);
  assert.ok(files.size, 'the map cites the files behind the grid');
  for (const file of files) assert.ok(existsSync(join(ROOT, file)), `${file} is cited by ${MAP} and must exist`);
});

test('every name the grid map cites is defined where it says (Issue #1695)', () => {
  const APP = read('public/app.js');
  const sources = new Map([['public/app.js', APP]]);
  const misses = [];
  for (const row of rows()) {
    const names = cited(row);
    const inRow = names.filter((n) => n.includes('/'));
    for (const file of inRow) if (!sources.has(file)) sources.set(file, read(file));
    const haystack = inRow.length ? inRow.map((f) => sources.get(f)).join('\n') + '\n' + APP : APP;
    for (const name of names) {
      if (name.includes('/') || name.includes(' ') || name.startsWith('wv-') || name.includes('.')) continue;
      if (!new RegExp(`\\b${name}\\b`).test(haystack)) misses.push(`${name} (row: ${row.trim()})`);
    }
  }
  assert.deepEqual(misses, [], `${MAP} names code that is gone; fix the map or the name`);
});
