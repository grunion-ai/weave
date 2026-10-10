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

const JOB_SCOPE = /^ {4,}(?:packages|id-token): write$/;
const widePermissions = (src) => {
  const pr = /^\s+pull_request(?:_target)?:/m.test(src);
  return src.split('\n').filter((l) => /(write|admin)\s*$/.test(l) && (pr || !JOB_SCOPE.test(l)));
};
test('every workflow grants contents: read at the top level; a job widens only packages or id-token, and only where no pull request can run it', () => {
  for (const f of files) {
    const src = text(f);
    assert.match(src, /^permissions:\n  contents: read\n/m, `${f}: top-level permissions block`);
    assert.deepEqual(widePermissions(src), [], `${f}: a write permission`);
  }
  const job = 'permissions:\n  contents: read\njobs:\n  image:\n    permissions:\n      contents: read\n      packages: write\n      id-token: write\n';
  assert.deepEqual(widePermissions(`on:\n  push:\n    tags: ["v*"]\n${job}`), []);
  assert.deepEqual(widePermissions(`on:\n  pull_request:\n${job}`), ['      packages: write', '      id-token: write']);
  assert.deepEqual(widePermissions('on:\n  push:\npermissions:\n  contents: read\njobs:\n  a:\n    permissions:\n      contents: write\n'), ['      contents: write']);
});

test('every workflow checks out the full history the history-reading tests need', () => {
  const checkouts = [];
  for (const f of files) {
    const lines = text(f).split('\n');
    for (const [i, line] of lines.entries()) {
      if (!/^\s*-\s*uses:\s*actions\/checkout@/.test(line)) continue;
      const indent = line.search(/\S/) + 2;
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
