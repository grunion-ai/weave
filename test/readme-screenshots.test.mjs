import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from '../scripts/screenshots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const README = read('README.md');
const DIR = join(ROOT, 'docs', 'screenshots');
const referenced = [...README.matchAll(/docs\/screenshots\/([\w-]+)\.png/g)].map((m) => m[1]);
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''));

test('every screenshot the README shows exists on disk', () => {
  for (const name of referenced) {
    assert.ok(existsSync(join(DIR, `${name}.png`)), `README shows docs/screenshots/${name}.png, which is missing`);
  }
});

test('docs/screenshots holds no image the README does not show', () => {
  for (const name of onDisk) {
    assert.ok(referenced.includes(name), `docs/screenshots/${name}.png is shown nowhere in the README; delete it or show it`);
  }
});

test('scripts/screenshots.mjs captures exactly the README\'s screenshots', () => {
  assert.deepEqual(SHOTS.map(([file]) => file).sort(), [...new Set(referenced)].sort());
});

test('the README shows the Board layout and the phone layout', () => {
  assert.ok(referenced.includes('board'), 'README shows docs/screenshots/board.png');
  assert.ok(referenced.includes('phone'), 'README shows docs/screenshots/phone.png');
});

test('the README Views row names the table, list and board layouts', () => {
  const row = README.split('\n').find((l) => l.startsWith('| Views |'));
  assert.ok(row, 'README has a Views row');
  for (const layout of [/\btable\b/i, /\blist\b/i, /\bboard\b/i, /\bkanban\b/i]) assert.match(row, layout, row);
});

test('the other screenshot indexes list the board and phone shots', () => {
  const docsIndex = read('docs/README.md').split('\n').find((l) => l.includes('[Screenshots]'));
  const llms = read('llms.txt').split('\n').find((l) => l.includes('[Screenshots]'));
  for (const line of [docsIndex, llms]) {
    assert.ok(line, 'screenshot index line present');
    assert.match(line, /\b(board|kanban)\b/i, line);
    assert.match(line, /\bphone\b/i, line);
  }
});

test('the Airtable comparison maps no Airtable view onto a removed weave view', () => {
  const rows = read('docs/comparison/airtable.md').split('\n').filter((l) => l.startsWith('|'));
  for (const l of rows) {
    const weave = l.split('|')[2]?.trim() ?? '';
    assert.doesNotMatch(weave, /^(board|list) view$/i, l);
  }
});
