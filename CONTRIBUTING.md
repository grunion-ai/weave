# Contributing to weave

Thanks for looking. weave is small on purpose, and the constraints below are the
reason it stays a `git clone` away from running.

## Before you start

- **Check the roadmap.** The issue tracker and roadmap live inside weave itself,
  in the docs workspace at `/w/weave/` (Development space) on any running
  instance. GitHub Issues is the front door for people outside that instance.
- **Open an issue before a large change.** A feature that adds a dependency, a
  build step, or a new interface will be declined regardless of quality — those
  are project-shape decisions, not code-review ones.

## Setup

```bash
git clone https://github.com/grunion-ai/weave
cd weave
node bin/weave.js serve --port 4400 --data ./my-workspace.db
```

Node ≥ 22.16 (Node 24 LTS recommended). There is nothing to install.

## The rules

1. **Tests first, and they must pass.**

   ```bash
   node --test 'test/**/*.test.mjs'
   ```

   New engine or server behavior lands with tests in the same change. Bug fixes
   land with a test that fails before the fix.

2. **Zero runtime dependencies.** Nothing goes in `dependencies`. Storage is
   `node:sqlite`, built into Node. Browser-side third-party code is **vendored
   and pinned** into `public/vendor/`, never npm-installed. Dev tooling under
   `scripts/` and `brand/` may import a package, but with a dynamic `import()`
   so the test suite still loads without it.

3. **No build step.** The UI is vanilla JS served as-is. If a change needs
   compiling, bundling, or transpiling, it is the wrong change.

4. **Both themes.** Check UI work in light and dark (`data-bs-theme`). Styling
   uses Tabler tokens (`--tblr-*`).

5. **Never commit workspace data.** `*.db` (and `-wal`/`-shm`), legacy `*.json`
   workspaces, and `files/` are gitignored local state.

## Pull requests

- One concern per PR, with a description of what changed and why.
- Say how you verified it — the test output, or the steps you ran in the UI.
- Screenshots for UI changes, in both themes.
- README screenshots are generated, not hand-cropped:
  `node scripts/screenshots.mjs --url http://127.0.0.1:4400`.

## Reporting bugs

Open a [GitHub issue](https://github.com/grunion-ai/weave/issues/new/choose)
with the version (`git rev-parse --short HEAD`), your Node version, what you
did, what happened, and what you expected. For anything security-related, do not
open an issue — see [SECURITY.md](SECURITY.md).

## License

Contributions are accepted under the [MIT License](LICENSE), the same terms as
the project.
