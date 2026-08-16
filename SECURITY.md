# Security Policy

## Supported versions

weave ships from `main`. Fixes land there; there are no maintained release
branches. Update with `git pull`.

## The threat model, stated up front

Two properties of weave are **by design**, not vulnerabilities:

- **No authentication and no per-user permissions.** Anyone who can reach the
  port can read and write every workspace on that instance. The server binds
  `127.0.0.1`; a self-hosted install is expected to sit behind a reverse proxy,
  SSO proxy, or private network that does the authenticating. See
  [Self-hosting](README.md#self-hosting).
- **Documents may contain raw HTML, and it renders same-origin.** Write access
  to a shared workspace is equivalent to write access to a repo — grant it
  accordingly.

Reports that a directly-internet-exposed instance is unauthenticated, or that a
user who can already write documents can inject HTML into their own workspace,
will be closed as working-as-documented.

## What is in scope

- Reading or writing data across a boundary weave claims to enforce — for
  example escaping a workspace via a crafted entity ref, path traversal in the
  document or file routes, or reaching outside the data directory.
- Remote code execution, including through the formula evaluator, CSV import, or
  document rendering.
- Anything that lets an unauthenticated request reach an instance bound to
  `127.0.0.1` (DNS rebinding, `Host`-header handling, CSRF against the REST API).
- Corruption or loss of a workspace file triggered by ordinary input.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private reporting:

1. Go to <https://github.com/grunion-ai/weave/security/advisories/new>
2. Include the commit (`git rev-parse --short HEAD`), your Node version,
   reproduction steps, and the impact you believe it has.

You will get an acknowledgement within a week. This is a small project with no
bug-bounty budget — what we can offer is a prompt fix and credit in the advisory
and commit, unless you would rather stay anonymous.

Please give us a reasonable window to ship a fix before disclosing publicly.
