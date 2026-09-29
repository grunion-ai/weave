/* Issue #459 — `behind` said "differs from main", not "older than main".
   describeBuild set `behind: latest !== head`, so a dev worktree one commit
   ahead of main, a feature branch, or any checkout that already carried main's
   tip read as behind and raised the amber chip and the "behind main" toast.
   Behind now means main has a commit this checkout lacks: the boot HEAD does
   not contain main's sha (`git merge-base --is-ancestor <latest> HEAD` fails,
   which a sha missing from the local object store also does). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeBuild, headContains } from '../src/server.js';

const sha = (c) => c.repeat(40);

test('describeBuild: a checkout ahead of main is not behind', () => {
  const b = describeBuild({ head: sha('a'), disk: sha('a'), latest: sha('b'), contains: true });
  assert.equal(b.behind, false, 'HEAD already carries main');
  assert.equal(b.latestSha, 'bbbbbbb', 'latestSha still names main');
});

test('describeBuild: a branch that lacks main is behind', () => {
  const b = describeBuild({ head: sha('a'), disk: sha('a'), latest: sha('b'), contains: false });
  assert.equal(b.behind, true);
});

test('describeBuild: at main is never behind', () => {
  assert.equal(describeBuild({ head: sha('a'), latest: sha('a'), contains: false }).behind, false);
});

test('headContains: ancestry against a real checkout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-behind-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).stdout.trim();
  try {
    git('init', '-q');
    const commit = (n) => {
      writeFileSync(join(dir, 'f'), n);
      git('add', 'f');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', n);
      return git('rev-parse', 'HEAD');
    };
    const main = commit('main');
    const ahead = commit('ahead');
    assert.equal(await headContains(dir, main), true, 'one commit ahead of main contains it');
    assert.equal(await headContains(dir, ahead), true, 'at main contains it');
    git('checkout', '-q', main);
    assert.equal(await headContains(dir, ahead), false, 'an older checkout lacks it');
    assert.equal(await headContains(dir, sha('e')), false, 'a sha never fetched is not contained');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
