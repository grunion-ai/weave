# Contributing to weave

Thanks for looking. weave is small on purpose, and the constraints below are the
reason it stays a `git clone` away from running.

## Before you start

- **Check the roadmap.** The issue tracker and roadmap live inside weave itself,
  in the docs workspace at `/w/weave/` (Development space) on any running
  instance. GitHub Issues is the front door for people outside that instance.
- **Open an issue before a large change.** A feature that adds a dependency, a
  build step, or a new interface will be declined regardless of quality: those
  are project-shape decisions, not code-review ones.

## Setup

```bash
git clone https://github.com/grunion-ai/weave
cd weave
node bin/weave.js serve --port 4400 --data ./my-workspace.db
```

Node ≥ 22.16 (Node 24 LTS recommended), the floor `node:sqlite` needs. There is
nothing to install.

## The rules

Every change follows these. This list is their one home; other docs point here.

1. **Tests first, and they must pass.** New engine or server behavior lands with
   tests in the same change, and a bug fix lands with a test that fails before
   the fix. Run the tests for what you changed:

   ```bash
   npm test -- --targeted test/formula.test.mjs
   ```

   `npm test` alone runs every suite, and CI runs them all on your pull request
   and again on main. [DEVELOPMENT.md › Running tests](DEVELOPMENT.md#running-tests)
   has the flags, the browser helpers and the ledgers.

2. **Zero runtime dependencies.** Nothing goes in `dependencies`. Storage is
   `node:sqlite`, built into Node. Third-party code is **vendored and pinned**
   under `public/vendor/` and `src/vendor/`, never npm-installed:
   `security/vendor.lock.json` holds each library's version and file hashes,
   and the README's [Third-party](README.md#third-party-vendored-pinned) list is
   generated from it. Tabler's CSS is trimmed to the selectors the app names by
   `scripts/trim-tabler.mjs`. Dev tooling under `scripts/` and `brand/` may
   import a package, but with a dynamic `import()` so the test suite still loads
   without it.

3. **No build step.** The UI is vanilla JS served as-is. If a change needs
   compiling, bundling, or transpiling, it is the wrong change.

4. **Both themes.** Check UI work in light and dark (`data-bs-theme`). Styling
   uses Tabler tokens (`--tblr-*`) with Radix-style soft squared chips, and every
   background comes from the surface table in [brand/README.md](brand/README.md)
   ("Surfaces").

5. **Never commit workspace data.** `*.db` (and `-wal`/`-shm`), legacy `*.json`
   workspaces, and `files/` are gitignored local state. The engine refuses
   non-workspace JSON and foreign SQLite files; keep it that way.

6. **No inline comments.** weave's own code carries no `//`, `/* */` or
   `<!-- -->` comments (Issue #661). The why goes in the commit message and the
   Issue or Feature record, a `ponytail:` upgrade path included. Vendored code,
   `brand/` and `docs/` are exempt.

7. **One changelog fragment per change.** Write your bullet(s) to
   `changelog.d/<short-slug>-<Issue or Feature number>.md` and never edit
   CHANGELOG.md; a release folds the fragments in. A commit that changes `src/`,
   `public/`, `bin/` or `scripts/` and names `(Issue #N)` or `(Feature #N)` in
   its subject needs a fragment, or a `No-changelog: <reason>` trailer.

8. **Copy follows SOUL.md.** Before you write about weave (README, docs, release
   notes, site, posts, UI strings), read [SOUL.md](SOUL.md): purpose, audience,
   voice, positioning and refusals.

## Pull requests

- One concern per PR, with a description of what changed and why.
- Say how you verified it: the test output, or the steps you ran in the UI.
- Screenshots for UI changes, in both themes.
- README screenshots are generated, not hand-cropped:
  `node scripts/screenshots.mjs --url http://127.0.0.1:4400`.

## Reporting bugs

Open a [GitHub issue](https://github.com/grunion-ai/weave/issues/new/choose)
with the version (`git rev-parse --short HEAD`), your Node version, what you
did, what happened, and what you expected. For anything security-related, do not
open an issue; see [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the [MIT License](LICENSE), the same terms as
the project.
