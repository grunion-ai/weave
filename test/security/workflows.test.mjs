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

/* Several tests read git history, not just the tree: architecture-map.test.mjs asks
   `merge-base --is-ancestor` whether the map's pinned revision is behind HEAD, and
   changelog-fragments.test.mjs diffs HEAD against its parent. A depth-1 checkout holds
   neither object, so the pin test fails on every landing and the CHANGELOG test asserts
   nothing (Issue #558). Full history is the rule for every workflow here. */
test('every workflow checks out the full history the history-reading tests need', () => {
  const checkouts = [];
  for (const f of files) {
    const lines = text(f).split('\n');
    for (const [i, line] of lines.entries()) {
      if (!/^\s*-\s*uses:\s*actions\/checkout@/.test(line)) continue;
      const indent = line.search(/\S/) + 2; // the step's own keys sit under the "- "
      const step = [line];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && lines[j].search(/\S/) < indent) break;
        step.push(lines[j]);
      }
      checkouts.push({ at: `${f}:${i + 1}`, full: /^\s*fetch-depth:\s*0\s*(#.*)?$/m.test(step.join('\n')) });
    }
  }
  assert.deepEqual(files.filter((f) => !checkouts.some((c) => c.at.startsWith(`${f}:`))), [], 'a workflow that never checks out the repository');
  assert.deepEqual(checkouts.filter((c) => !c.full).map((c) => c.at), [], 'a checkout step without `fetch-depth: 0`');
});

test('security.yml runs on push to main, on pull requests and weekly, and calls the scan script', () => {
  const src = text('security.yml');
  assert.match(src, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n  schedule:\n(?:    #.*\n)*    - cron: "\d+ \d+ \* \* 1"/m);
  assert.match(src, /node scripts\/security-scan\.mjs/);
});
