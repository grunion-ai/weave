import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, SECTIONS, renderEnvironmentReference } from '../src/env.js';
import { GUIDES } from '../src/handbook.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = 'src/handbook/guides/environment-reference.md';
const REGEN = 'edit the entry in src/env.js, then run node src/env.js';

const READ = /\benv(?:\?\.|\.)([A-Z][A-Z0-9_]*)\b|\benv(?:\?\.)?\[\s*(['"])([A-Z][A-Z0-9_]*)\2\s*\]/g;
const SPELLED = /\bWEAVE_[A-Z0-9_]+\b/g;

const readsIn = (text) => [...text.matchAll(READ)].map((m) => m[1] ?? m[3]);

function sourceFiles() {
  const files = [];
  for (const dir of ['src', 'bin']) {
    for (const f of readdirSync(join(ROOT, dir), { recursive: true })) {
      const path = `${dir}/${f}`.replaceAll('\\', '/');
      if (/\.(?:m?js)$/.test(path) && !path.startsWith('src/vendor/')) files.push(path);
    }
  }
  return files.sort();
}

function sites(pattern) {
  const found = new Map();
  for (const file of sourceFiles()) {
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      for (const name of pattern(line)) found.set(name, [...(found.get(name) ?? []), `${file}:${i + 1}`]);
    });
  }
  return found;
}

const NAMES = new Set(ENV.map((v) => v.name));
const reads = sites(readsIn);

test('the scanner finds a dotted, an optional and a bracketed read and nothing that only looks like one', () => {
  assert.deepEqual(
    readsIn("const a = process.env.WEAVE_ONE ?? env?.WEAVE_TWO; const b = env['WEAVE_THREE'] + process.env[\"PORT\"]; const c = myenv.WEAVE_FOUR; envy.WEAVE_FIVE;"),
    ['WEAVE_ONE', 'WEAVE_TWO', 'WEAVE_THREE', 'PORT'],
  );
});

test('every environment variable src/ and bin/ read is in the registry src/env.js (Issue #1583)', () => {
  assert.ok(reads.size >= 60, `only ${reads.size} variables found: the scanner no longer matches the code`);
  const missing = [...reads].filter(([name]) => !NAMES.has(name)).map(([name, at]) => `${name} (${at.join(', ')})`);
  assert.deepEqual(missing, [], `the code reads variables src/env.js does not document: ${REGEN}`);
});

test('every WEAVE_ name src/ and bin/ spell is a registered variable, so a read through a computed name is documented too', () => {
  const spelled = sites((line) => line.match(SPELLED) ?? []);
  const missing = [...spelled].filter(([name]) => !NAMES.has(name)).map(([name, at]) => `${name} (${at.join(', ')})`);
  assert.deepEqual(missing, [], `the code names variables src/env.js does not document: ${REGEN}`);
});

test('the registry names each variable once, and only variables the code reads', () => {
  const seen = new Set();
  const twice = ENV.map((v) => v.name).filter((name) => seen.has(name) || !seen.add(name));
  assert.deepEqual(twice, [], 'a variable has two registry entries');
  const stale = ENV.map((v) => v.name).filter((name) => !reads.has(name));
  assert.deepEqual(stale, [], 'src/env.js documents variables src/ and bin/ no longer read: delete the entry, then run node src/env.js');
});

test('every entry names its section, who reads it, its default and what breaks, each one table cell', () => {
  const ids = new Set(SECTIONS.filter((s) => s.id).map((s) => s.id));
  for (const v of ENV) {
    assert.match(v.name, /^[A-Z][A-Z0-9_]*$/, `${v.name} is not an environment variable name`);
    assert.ok(ids.has(v.section), `${v.name} names section ${v.section}, which the page does not have`);
    for (const key of ['readBy', 'default', 'doc']) {
      assert.equal(typeof v[key], 'string', `${v.name} has no ${key}`);
      assert.ok(v[key].trim(), `${v.name} has an empty ${key}`);
      assert.doesNotMatch(v[key], /\n|(?<!\\)\|/, `${v.name} ${key} would break its table row`);
    }
  }
  for (const id of ids) assert.ok(ENV.some((v) => v.section === id), `section ${id} lists no variable`);
});

test('the Environment reference guide is rendered from the registry and documents every variable once', () => {
  const file = readFileSync(join(ROOT, GUIDE), 'utf8');
  assert.equal(file, renderEnvironmentReference(), `${GUIDE} is stale or was edited by hand: ${REGEN}`);
  const guide = GUIDES.find((g) => g.name === 'Environment reference');
  assert.ok(guide, 'the Handbook seed ships the Environment reference guide');
  assert.equal(guide.doc, file, 'the Handbook ships the rendered page as it is');
  const rows = [...file.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...rows].sort(), [...NAMES].sort(), 'every registered variable has exactly one row, and every row is a registered variable');
});

test('the deploy contract opens the page and holds the variables the container is built with', () => {
  const sections = renderEnvironmentReference().split('\n## ').slice(1).map((s) => s.slice(0, s.indexOf('\n')));
  assert.equal(sections[0], 'The deploy contract');
  assert.equal(sections.at(-1), 'How you know it worked');
  for (const name of ['PORT', 'WEAVE_HOST', 'WEAVE_DATA', 'WEAVE_KEYSTORE', 'WEAVE_KEYSTORE_PASSPHRASE']) {
    assert.equal(ENV.find((v) => v.name === name)?.section, 'deploy', `${name} belongs to the deploy contract`);
  }
});
