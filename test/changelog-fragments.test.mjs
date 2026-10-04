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
import { fold, foldRepo, changelogGuard, fragmentGuard, openSecurityCitations, FRAGMENT_NAME } from '../scripts/changelog-fold.mjs';

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

/* Issue #629: fold skipped a fragment whose text trimmed to nothing and
   foldRepo deleted it anyway, so its change would ship with no line in
   CHANGELOG.md or the GitHub Release and nothing would say so. */
test('fold refuses an empty fragment and names it', () => {
  for (const text of ['', '\n', '  \n\t\n']) {
    assert.throws(() => fold(MD, [...FRAGS, { name: 'hollow-12.md', text }], { version: '0.4.44', date: '2026-09-27' }),
      /changelog\.d\/hollow-12\.md is empty/);
  }
});

test('foldRepo with an empty fragment writes nothing and deletes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-changelog-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.4.44' }));
  writeFileSync(join(dir, 'CHANGELOG.md'), MD);
  mkdirSync(join(dir, 'changelog.d'));
  for (const f of FRAGS) writeFileSync(join(dir, 'changelog.d', f.name), f.text);
  writeFileSync(join(dir, 'changelog.d', 'hollow-12.md'), '\n');
  assert.throws(() => foldRepo(dir, { date: '2026-09-27' }), /hollow-12\.md is empty/);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), MD);
  assert.deepEqual(readdirSync(join(dir, 'changelog.d')).sort(), ['alpha-7.md', 'hollow-12.md', 'zeta-9.md']);
});

/* Issue #568: changelog.d/mcp-inject-harness-499.md shipped the MCP injection
   measurement harness as "(Issue #499)", and #499 is security finding S-22,
   still Open. A finding's row stays Open until its fix lands, so the check
   runs at release time (scripts/export-development.mjs), when every landed
   fix has set its row Fixed; a fragment that still cites an open finding then
   ships other work under that finding's number. */
const ISSUES = [
  { number: 499, name: 'Error: security finding S-22, details held until the fix lands', status: 'Open' },
  { number: 494, name: 'Error: security finding S-17, details held until the fix lands', status: 'Fixed' },
  { number: 388, name: 'Looks broken: a sparkline Sample', status: 'Open' },
];

test('a fragment citing an open security finding is refused; a fixed finding or an ordinary open row passes', () => {
  const hits = openSecurityCitations([
    { name: 'mcp-inject-harness-499.md', text: '- **MCP injection measurement harness** (Issue #499): body.\n' },
    { name: 'pair-494.md', text: '- **Two fixes** (Issues #388 and #494): body.\n' },
    { name: 'list-12.md', text: '- **List** (Feature #12, Issues #388, #499): body.\n' },
  ], ISSUES);
  assert.deepEqual(hits, [
    'changelog.d/mcp-inject-harness-499.md cites Issue #499 (Error: security finding S-22, details held until the fix lands), which is still Open',
    'changelog.d/list-12.md cites Issue #499 (Error: security finding S-22, details held until the fix lands), which is still Open',
  ]);
  assert.deepEqual(openSecurityCitations([{ name: 'a-1.md', text: '- **A** (Issue #4990): body.\n' }], ISSUES), [], '#4990 is not #499');
});

test('the release export runs the security-citation check before it writes', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'export-development.mjs'), 'utf8');
  assert.match(src, /openSecurityCitations\(/);
  assert.ok(src.indexOf('openSecurityCitations(') < src.indexOf('writeFileSync(out'), 'refuses before docs/development.json is written');
});

test('the guard refuses CHANGELOG.md lines added without a version bump', () => {
  assert.match(changelogGuard({ added: 3, versionBefore: '0.4.43', versionAfter: '0.4.43' }), /changelog\.d\//);
  assert.equal(changelogGuard({ added: 3, versionBefore: '0.4.43', versionAfter: '0.4.44' }), null, 'a release commit');
  assert.equal(changelogGuard({ added: 0, versionBefore: '0.4.43', versionAfter: '0.4.43' }), null, 'removals only');
});

/* The other direction (Issue #573). Gerrit change 527 fixed Issue #551 and
   merged as e85ada8 with nine files, none under changelog.d/; the gate voted
   Verified +1 and the fix would have been missing from the v0.4.54 notes had
   the bullet not been written by hand at release time. changelogGuard watches
   CHANGELOG.md; fragmentGuard watches the fragment a code change owes. The two
   stay separate functions so a red names one direction and one fix. */
const FIX = {
  subject: 'grid: tab starts from the focused row (Issue #551)',
  message: 'grid: tab starts from the focused row (Issue #551)\n\nBody.\n\nChange-Id: I0123456789abcdef\n',
  files: ['src/grid.js', 'public/app.js', 'test/grid.test.mjs'],
  fragmentsAdded: 0,
  versionBefore: '0.4.63',
  versionAfter: '0.4.63',
};

test('a code change naming an Issue or Feature is refused when it adds no fragment', () => {
  const why = fragmentGuard(FIX);
  assert.match(why, /changelog\.d\/<short-slug>/, 'names the file to write');
  assert.match(why, /src\/grid\.js/, 'names the code file that asked for it');
  assert.match(why, /No-changelog/, 'names the opt-out');
  for (const subject of ['grid: two fixes (Issues #551, #552)', 'grid: tab order (Feature #236)', 'grid: three (Features #1, #2)']) {
    assert.match(fragmentGuard({ ...FIX, subject, message: `${subject}\n` }), /adds no changelog\.d/, subject);
  }
  for (const file of ['src/grid.js', 'public/app.js', 'bin/weave.js', 'scripts/changelog-fold.mjs']) {
    assert.match(fragmentGuard({ ...FIX, files: [file] }), /adds no changelog\.d/, file);
  }
});

test('a fragment, a No-changelog reason, or a release commit satisfies the fragment guard', () => {
  assert.equal(fragmentGuard({ ...FIX, fragmentsAdded: 1 }), null, 'a fragment added in the same commit');
  assert.equal(fragmentGuard({ ...FIX, message: `${FIX.message}No-changelog: a rename with no user-visible change\n` }), null, 'the opt-out trailer');
  assert.equal(fragmentGuard({ ...FIX, versionAfter: '0.4.64' }), null, 'a release commit deletes the fragments it folded');
});

test('the fragment guard passes a commit that names no row or touches no code', () => {
  assert.equal(fragmentGuard({ ...FIX, subject: 'grid: tab starts from the focused row', message: 'grid: tab starts from the focused row\n' }), null, 'no Issue or Feature in the subject');
  assert.equal(fragmentGuard({ ...FIX, subject: 'grid: tab order, see Issue #551', message: 'grid: tab order, see Issue #551\n' }), null, 'the subject names the row outside parentheses');
  assert.equal(fragmentGuard({ ...FIX, files: ['DEVELOPMENT.md', 'test/grid.test.mjs', 'docs/architecture/index.html'] }), null, 'no src/, public/, bin/ or scripts/ file');
  assert.equal(fragmentGuard({ ...FIX, files: [] }), null, 'no files at all');
});

test('a No-changelog trailer with no reason does not opt out', () => {
  for (const trailer of ['No-changelog:', 'No-changelog:   ']) {
    assert.match(fragmentGuard({ ...FIX, message: `${FIX.message}${trailer}\n` }), /No-changelog: <reason>/, trailer);
  }
});

test('every fragment is named <slug>-<number>.md and opens on a bullet', () => {
  const dir = join(ROOT, 'changelog.d');
  const names = existsSync(dir) ? readdirSync(dir) : [];
  for (const n of names) {
    assert.match(n, FRAGMENT_NAME, `${n}: name it changelog.d/<short-slug>-<Issue or Feature number>.md`);
    assert.match(readFileSync(join(dir, n), 'utf8'), /^- \S/, `${n} opens on a "- " bullet with text (Issue #629: an empty fragment ships its change with no note)`);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), /^## Unreleased/m, 'no Unreleased section: write a fragment');
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const parentsOf = (rev) => git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
const versionAt = (rev) => { try { return JSON.parse(git('show', `${rev}:package.json`)).version; } catch { return null; } };
const pathsIn = (...args) => git(...args).split('\n').filter(Boolean);
/* The commits this HEAD puts under test: for a merge HEAD, each non-merge
   parent's own diff; for a plain HEAD, HEAD. */
const underTest = () => {
  const parents = parentsOf('HEAD');
  return parents.length > 1 ? parents.filter((p) => parentsOf(p).length === 1) : parents.length ? ['HEAD'] : [];
};

test('this commit edits CHANGELOG.md only if it bumps the version', () => {
  for (const sha of underTest()) {
    const stat = git('diff', '--numstat', `${sha}^`, sha, '--', 'CHANGELOG.md');
    const added = stat ? Number(stat.split('\t')[0]) : 0;
    const why = changelogGuard({ added, versionBefore: versionAt(`${sha}^`), versionAfter: versionAt(sha) });
    assert.equal(why, null, `${sha.slice(0, 8)}: ${why}`);
  }
});

/* Issue #573: the same commits, read the other way round. A commit that
   changes code and names its row owes a fragment. Commits that landed before
   this guard did not all pay it (e85ada8, 0ccab1d, 5323354, 4c5faa3, ae87f1a,
   79f2f60), so a checkout of one of those is red on its own history, not on
   the change being tested. */
test('this commit ships the changelog.d fragment the code it changes owes', () => {
  for (const sha of underTest()) {
    const why = fragmentGuard({
      subject: git('log', '-1', '--format=%s', sha),
      message: git('log', '-1', '--format=%B', sha),
      files: pathsIn('diff', '--name-only', `${sha}^`, sha),
      fragmentsAdded: pathsIn('diff', '--name-only', '--diff-filter=A', `${sha}^`, sha, '--', 'changelog.d').length,
      versionBefore: versionAt(`${sha}^`),
      versionAfter: versionAt(sha),
    });
    assert.equal(why, null, `${sha.slice(0, 8)}: ${why}`);
  }
});
