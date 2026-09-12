/* Finder duplicates never land (Issue #277). Phase 2 of Feature #222 dragged
   six `* 2.*` copies into the tree — `test/auth-session.test 2.mjs`,
   `test/lib/authenticator 2.mjs`, `src/webauthn 2.js` and their siblings —
   and the runner walks `test/**` by suffix, so two suites ran twice on every
   gate and every green vote counted the duplicate. Finder names a copy by
   appending a space and a counter before the extension; nothing in this repo
   is named that way on purpose, so any tracked path that matches is a copy
   that slipped past `git add`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FINDER_COPY = / \d+\.[a-z]+$/;

export function finderDuplicates(paths) {
  return paths.filter((p) => FINDER_COPY.test(p));
}

test('the pattern catches Finder copies and nothing else', () => {
  assert.deepEqual(
    finderDuplicates(['test/webauthn.test 2.mjs', 'test/lib/authenticator 2.mjs', 'src/auth-page 2.js']),
    ['test/webauthn.test 2.mjs', 'test/lib/authenticator 2.mjs', 'src/auth-page 2.js'],
  );
  assert.deepEqual(
    finderDuplicates(['test/webauthn.test.mjs', 'docs/v0 2/x.md', 'public/icon-2.svg', 'CHANGELOG 2']),
    [],
  );
});

test('no tracked path is a Finder duplicate', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  assert.deepEqual(finderDuplicates(tracked), [], 'Finder copies tracked — delete them, the sibling is the real file');
});
