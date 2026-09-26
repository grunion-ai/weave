/* Changelog fragments (Issue #408). 37 of 48 commits on gerrit/main added a
   bullet under `## Unreleased` in CHANGELOG.md, and Gerrit refuses to
   auto-rebase two changes that touch the same file, so every landing sent
   every open change back for a hand rebase and a fresh full gate (GitHub PR
   #5 took six rebases in six hours). Now each change writes its own
   `changelog.d/<slug>-<Issue or Feature number>.md`, and only a release
   commit edits CHANGELOG.md: `scripts/changelog-fold.mjs` moves every
   fragment under the new `## v<version>` heading and deletes the fragments.

   The guard. A commit that adds lines to CHANGELOG.md must also change the
   package.json version. The gate (harness `scripts/weave-review.sh`) tests
   the patchset merged with main, so HEAD can be that merge, and Gerrit's own
   submits can land as `Merge "…" into main`. For a merge HEAD the guard
   checks each non-merge parent's own diff; for a plain HEAD it checks HEAD.
   A commit that only removes lines passes: that is this change, which moves
   the last `## Unreleased` bullets into fragments. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fold, foldRepo, changelogGuard, FRAGMENT_NAME } from '../scripts/changelog-fold.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MD = `# Changelog

Preamble.

## Unreleased

- **Old unreleased one** (Issue #1): body.

- **Old unreleased two** (Issue #2): body.

## v0.4.43 — 2026-09-26

- **Released** (Feature #3): body.
`;

const FRAGS = [
  { name: 'zeta-9.md', text: '- **Zeta** (Issue #9): body.\n' },
  { name: 'alpha-7.md', text: '- **Alpha** (Feature #7): body.\n  second line.\n' },
];

test('fold puts the Unreleased bullets and every fragment under the new heading, fragments sorted by name', () => {
  const out = fold(MD, FRAGS, { version: '0.4.44', date: '2026-09-27' });
  assert.equal(out, `# Changelog

Preamble.

## v0.4.44 — 2026-09-27

- **Old unreleased one** (Issue #1): body.

- **Old unreleased two** (Issue #2): body.
- **Alpha** (Feature #7): body.
  second line.
- **Zeta** (Issue #9): body.

## v0.4.43 — 2026-09-26

- **Released** (Feature #3): body.
`);
  assert.doesNotMatch(out, /## Unreleased/);
});

test('fold appends to a heading the release author already wrote', () => {
  const md = MD.replace('## Unreleased\n\n- **Old unreleased one** (Issue #1): body.\n\n- **Old unreleased two** (Issue #2): body.\n\n',
    '## v0.4.44 — 2026-09-27\n\n- **Digest line**.\n\n');
  const out = fold(md, [FRAGS[1]], { version: '0.4.44', date: 'ignored' });
  assert.match(out, /## v0\.4\.44 — 2026-09-27\n\n- \*\*Digest line\*\*\.\n- \*\*Alpha\*\*/);
  assert.equal(out.match(/## v0\.4\.44/g).length, 1);
});

test('fold is idempotent, and with nothing to fold it changes nothing', () => {
  const once = fold(MD, FRAGS, { version: '0.4.44', date: '2026-09-27' });
  assert.equal(fold(once, [], { version: '0.4.44', date: '2026-09-28' }), once);
  const plain = MD.replace(/## Unreleased[\s\S]*?(?=## v0)/, '');
  assert.equal(fold(plain, [], { version: '0.4.44', date: '2026-09-27' }), plain);
});

test('foldRepo writes CHANGELOG.md, deletes the fragments, and a second run is a no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-changelog-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.4.44' }));
  writeFileSync(join(dir, 'CHANGELOG.md'), MD);
  mkdirSync(join(dir, 'changelog.d'));
  for (const f of FRAGS) writeFileSync(join(dir, 'changelog.d', f.name), f.text);
  const first = foldRepo(dir, { date: '2026-09-27' });
  assert.deepEqual(first, { version: '0.4.44', folded: 2, changed: true });
  const after = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  assert.equal(after, fold(MD, FRAGS, { version: '0.4.44', date: '2026-09-27' }));
  assert.deepEqual(readdirSync(join(dir, 'changelog.d')), []);
  assert.deepEqual(foldRepo(dir, { date: '2026-09-28' }), { version: '0.4.44', folded: 0, changed: false });
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), after);
});

test('the guard refuses CHANGELOG.md lines added without a version bump', () => {
  assert.match(changelogGuard({ added: 3, versionBefore: '0.4.43', versionAfter: '0.4.43' }), /changelog\.d\//);
  assert.equal(changelogGuard({ added: 3, versionBefore: '0.4.43', versionAfter: '0.4.44' }), null, 'a release commit');
  assert.equal(changelogGuard({ added: 0, versionBefore: '0.4.43', versionAfter: '0.4.43' }), null, 'removals only');
});

test('every fragment is named <slug>-<number>.md and opens on a bullet', () => {
  const dir = join(ROOT, 'changelog.d');
  const names = existsSync(dir) ? readdirSync(dir) : [];
  for (const n of names) {
    assert.match(n, FRAGMENT_NAME, `${n}: name it changelog.d/<short-slug>-<Issue or Feature number>.md`);
    assert.match(readFileSync(join(dir, n), 'utf8'), /^- /, `${n} opens on a "- " bullet`);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), /^## Unreleased/m, 'no Unreleased section: write a fragment');
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const parentsOf = (rev) => git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
const versionAt = (rev) => { try { return JSON.parse(git('show', `${rev}:package.json`)).version; } catch { return null; } };

test('this commit edits CHANGELOG.md only if it bumps the version', () => {
  const parents = parentsOf('HEAD');
  const commits = parents.length > 1 ? parents.filter((p) => parentsOf(p).length === 1) : parents.length ? ['HEAD'] : [];
  for (const sha of commits) {
    const stat = git('diff', '--numstat', `${sha}^`, sha, '--', 'CHANGELOG.md');
    const added = stat ? Number(stat.split('\t')[0]) : 0;
    const why = changelogGuard({ added, versionBefore: versionAt(`${sha}^`), versionAfter: versionAt(sha) });
    assert.equal(why, null, `${sha.slice(0, 8)}: ${why}`);
  }
});
