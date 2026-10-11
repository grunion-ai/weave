import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../../.github/workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const text = (f) => readFileSync(join(DIR, f), 'utf8');

test('every action in every workflow is pinned to a full commit SHA', () => {
  const bad = [];
  for (const f of files) {
    for (const [i, line] of text(f).split('\n').entries()) {
      const m = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
      if (!m || m[1].startsWith('./')) continue;
      if (!/@[0-9a-f]{40}$/.test(m[1])) bad.push(`${f}:${i + 1} ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('workflow write permissions are confined to guarded release delivery', () => {
  for (const f of files) {
    const src = text(f);
    assert.match(src, /^permissions:\n  contents: read\n/m, `${f}: top-level permissions block`);
    if (f === 'test.yml') {
      const release = src.slice(src.indexOf('  release:'));
      assert.doesNotMatch(src.slice(0, src.indexOf('  release:')), /(write|admin)\s*$/m);
      assert.equal((src.match(/: write/g) ?? []).length, 1);
      assert.match(release, /name: Release/);
      assert.match(release, /needs: gate/);
      assert.match(release, /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/);
      assert.match(release, /permissions:\n      contents: write\n      actions: read/);
      assert.match(release, /uses: \.\/\.github\/workflows\/release\.yml/);
      assert.doesNotMatch(release, /steps:|secrets: inherit/);
      assert.match(release, /uses: \.\/\.github\/workflows\/release\.yml # zizmor: ignore\[self-repository\]/);
      assert.equal((src.match(/zizmor: ignore/g) ?? []).length, 1);
    } else if (f !== 'release.yml') assert.doesNotMatch(src, /(write|admin)\s*$/m, `${f}: a write permission`);
    else {
      const publish = src.slice(src.indexOf('  publish:'));
      assert.doesNotMatch(src.slice(0, src.indexOf('  publish:')), /(write|admin)\s*$/m);
      assert.match(publish, /permissions:\n      contents: write\n      actions: read/);
      assert.equal((src.match(/: write/g) ?? []).length, 1);
      assert.match(publish, /needs: guard/);
      assert.match(publish, /if: needs.guard.outputs.current == 'true'/);
      assert.match(publish, /ref: \$\{\{ needs.guard.outputs.sha \}\}/);
    }
  }
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


test('release validates main CI before checking out the tested SHA with write credentials', () => {
  const src = text('release.yml');
  assert.match(src, /workflow_call:/);
  assert.match(src, /github.event_name == 'push'/);
  assert.doesNotMatch(src, /workflow_run:/);
  assert.match(src, /github.ref == 'refs\/heads\/main'/);
  assert.match(src, /node scripts\/github-release\.mjs --guard/);
  assert.equal((src.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.doesNotMatch(src, /pull_request_target|download-artifact/);
});
