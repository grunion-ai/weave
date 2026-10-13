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
    if (f === 'sheriff.yml') {
      const head = src.slice(0, src.indexOf('\njobs:'));
      assert.doesNotMatch(head, /(write|admin)\s*$/m, 'sheriff.yml: a top-level write permission');
      assert.match(src, /runs-on: ubuntu-latest\n    timeout-minutes: 150\n    permissions:\n      contents: write\n      actions: write\n      pull-requests: write\n      issues: write\n    steps:/);
      assert.match(src, /github\.event\.workflow_run\.event == 'push'/);
      assert.match(src, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
      assert.match(src, /ref: main\n/);
      assert.doesNotMatch(src, /workflow_run\.head_sha|workflow_run\.head_branch \}\}|pull_request_target/);
    } else if (f === 'dev-soak.yml') {
      assert.doesNotMatch(src.slice(0, src.indexOf('\njobs:')), /(write|admin)\s*$/m, 'dev-soak.yml: a top-level write permission');
      assert.deepEqual(src.match(/^ +\S+: (write|admin)$/gm).map((l) => l.trim()), ['statuses: write']);
      assert.match(src, /timeout-minutes: 30\n    permissions:\n      contents: read\n      statuses: write\n    concurrency:/);
      assert.match(src, /github\.event\.workflow_run\.event == 'push'/);
      assert.match(src, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
      assert.match(src, /ref: main\n/);
      assert.doesNotMatch(src, /pull_request_target/);
    } else if (f !== 'release.yml') assert.doesNotMatch(src, /(write|admin)\s*$/m, `${f}: a write permission`);
    else {
      const job = (name) => src.slice(src.indexOf(`  ${name}:\n`)).split(/\n(?=  \S)/)[0];
      const publish = job('publish');
      assert.doesNotMatch(src.slice(0, src.indexOf('  publish:')), /(write|admin)\s*$/m);
      assert.match(publish, /permissions:\n      contents: write\n      actions: read/);
      assert.match(job('image'), /permissions:\n      contents: read\n      packages: write\n/);
      assert.match(job('registry'), /permissions:\n      contents: read\n      id-token: write\n/);
      assert.deepEqual(src.match(/^ +\S+: write$/gm).map((l) => l.trim()), ['contents: write', 'packages: write', 'id-token: write']);
      for (const name of ['image', 'registry']) {
        assert.match(job(name), /if: needs.guard.outputs.current == 'true'/, `${name} runs only for the current release`);
        assert.match(job(name), /ref: \$\{\{ needs.guard.outputs.sha \}\}/, `${name} builds the tested SHA`);
      }
      assert.match(job('image'), /needs: \[guard, publish\]/);
      assert.match(job('registry'), /needs: \[guard, image\]/);
      assert.match(publish, /needs: guard/);
      assert.match(publish, /environment:\n      name: production\n/);
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
  assert.match(src, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(src, /workflow_call:|^  push:/m);
  assert.doesNotMatch(text('test.yml'), /release\.yml/);
  assert.doesNotMatch(src, /workflow_run:/);
  assert.match(src, /github.ref == 'refs\/heads\/main'/);
  assert.match(src, /node scripts\/github-release\.mjs --guard/);
  const checkouts = (src.match(/uses: actions\/checkout@/g) ?? []).length;
  assert.equal(checkouts, 4);
  assert.equal((src.match(/persist-credentials: false/g) ?? []).length, checkouts, 'every checkout drops its credentials');
  assert.doesNotMatch(src, /pull_request_target|download-artifact/);
});

test('dev.yml gates ready pull requests in seconds and swaps dev on every main push', () => {
  const src = text('dev.yml');
  assert.match(src, /^on:\n  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n  push:\n    branches: \[main\]\n/m);
  const gate = src.slice(src.indexOf('  gate:'), src.indexOf('  deploy:'));
  const deploy = src.slice(src.indexOf('  deploy:'));
  assert.match(gate, /name: Dev gate\n    if: github.event_name == 'pull_request' && !github.event.pull_request.draft\n/);
  assert.match(gate, /timeout-minutes: [1-3]\n/);
  assert.match(gate, /node --check/);
  assert.match(gate, /\/api\/health/);
  assert.doesNotMatch(gate, /secrets\./);
  assert.match(deploy, /if: github.event_name == 'push'\n/);
  assert.match(deploy, /group: dev-deploy\n      cancel-in-progress: true/);
  assert.match(deploy, /DEV_DEPLOY_TOKEN: \$\{\{ secrets.DEV_DEPLOY_TOKEN \}\}/);
  assert.doesNotMatch(deploy.split('run: |')[1], /\$\{\{/, 'no expression is spliced into the deploy script');
  assert.match(deploy, /_supervisor\/check/);
  assert.match(deploy, /\.supervisor\.commit/);
});
