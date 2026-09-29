import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../../.github/workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const text = (f) => readFileSync(join(DIR, f), 'utf8');

test('every action in every workflow is pinned to a full commit SHA with its version in a comment', () => {
  const bad = [];
  for (const f of files) {
    for (const [i, line] of text(f).split('\n').entries()) {
      const m = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
      if (!m || m[1].startsWith('./')) continue;
      if (!/@[0-9a-f]{40}$/.test(m[1]) || !/^\s+#\s*v\d/.test(m[2])) bad.push(`${f}:${i + 1} ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every workflow grants contents: read at the top level and nothing wider', () => {
  for (const f of files) {
    const src = text(f);
    assert.match(src, /^permissions:\n  contents: read\n/m, `${f}: top-level permissions block`);
    assert.doesNotMatch(src, /(write|admin)\s*$/m, `${f}: a write permission`);
  }
});

test('security.yml runs on push to main, on pull requests and weekly, and calls the scan script', () => {
  const src = text('security.yml');
  assert.match(src, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n  schedule:\n(?:    #.*\n)*    - cron: "\d+ \d+ \* \* 1"/m);
  assert.match(src, /node scripts\/security-scan\.mjs/);
});
