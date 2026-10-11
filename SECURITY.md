# Security Policy

## Supported versions

weave ships from `main` and keeps no release branches. A fix lands there,
reaches a hosted install at the next release tag, and reaches a local install
on `git pull`.

## The threat model

Each workspace on an instance is one SQLite file. Three settings decide who can
read or write it.

**Accounts and roles.** An account holds one role in a workspace. Observers
read and comment, editors write rows, and architects also change structure,
accounts and keys. No role is scoped below the workspace: nothing narrows
access to one space, row or field.

**Tokens and sign-in.** Agents hold `wv_` bearer tokens, stored hashed. People
sign in through one OpenID Connect provider that the operator configures. weave
keeps no password store of its own.

**The `requireAuth` switch.** Authentication is off until an architect runs
`weave workspace require-auth` on a workspace. With the switch off, anyone who
reaches the port does everything an architect can in that workspace. With it
on, every page and API route refuses a caller without a token or a signed-in
session. The routes that stay open are `/api/health`, a share link, the task
applet and the sign-in page.

A local install binds `127.0.0.1`, so only your own machine reaches it. A
hosted install runs the container, which binds `0.0.0.0` behind the platform's
proxy. The operator sets `WEAVE_ORIGIN` and `WEAVE_TRUST_PROXY=1`, puts a door
(an edge gate or an identity provider, in the Handbook's term) in front of the
port and turns `requireAuth` on before anyone else can reach it. The Handbook
guides under Self-hosting walk through each target.

The server also applies these checks to every request:

- A Host allowlist. Loopback names, the host of `WEAVE_ORIGIN` and the entries
  of `WEAVE_ALLOWED_HOSTS` are served. Any other `Host` header gets `421`.
- A cross-site write check. A write whose `Origin` header names another site
  gets `403`. A request with no `Origin` header, such as curl, the CLI or an
  agent, is served.
- Security headers. Every response carries `X-Content-Type-Options: nosniff`
  and `Referrer-Policy: same-origin`. Every page carries a Content Security
  Policy whose `frame-ancestors 'self'` is extended only by
  `WEAVE_FRAME_ANCESTORS`. A request that arrived over https adds
  `Strict-Transport-Security`.
- Inert attachments. An uploaded file downloads as `application/octet-stream`
  unless its bytes prove an image type, or its type is PDF or plain text. Those
  open in place under `Content-Security-Policy: sandbox; default-src 'none'`.
  `WEAVE_INLINE_FILE_TYPES` adds types served in place, still sandboxed. An
  HTML attachment opens only in a sandboxed frame. A workspace logo is typed
  from its bytes and served the same way.

### A current limitation

A document of kind `html` is served at `/e/<ref>/<name>.html` as `text/html`
on the application's origin. Script inside it runs as whoever opens the page,
so an editor can place script in front of an architect. We are reviewing this
limitation and will decide the design change separately. Until it lands, grant
editor access the way you grant write access to a repository.

## In scope

- Reading or writing data across a boundary weave enforces: escaping a
  workspace through a crafted entity ref, path traversal in the document or
  file routes, or a path that leaves the data directory.
- Privilege escalation between roles: an observer who writes, an editor who changes
  structure, accounts or keys, or a route that skips `requireAuth`.
- A share link reaching more than its view: a token that opens a row, table or
  space outside its grant, or writes where the grant is read-only.
- Stored content acting in another signed-in user's browser: markup or script
  in a field, a document, an attachment or a logo that runs on the application
  origin, beyond the `html` document limitation stated above.
- Remote code execution, including through the formula evaluator, CSV import or
  document rendering.
- Reaching an instance from a site it did not serve: DNS rebinding, `Host`-header
  handling, or a cross-site write against the REST API or `/mcp`.
- Corruption or loss of a workspace file triggered by ordinary input.

Two reports fall outside scope. An instance exposed to the internet with
`requireAuth` off is a misconfiguration, and a report about one gets the
Self-hosting guides as its answer. The `html` document limitation above is known
and already has an owner.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private reporting:

1. Go to <https://github.com/grunion-ai/weave/security/advisories/new>
2. Include the commit (`git rev-parse --short HEAD`), your Node version,
   reproduction steps, and the impact you believe it has.

You will get an acknowledgement within a week. This is a small project with no
bug-bounty budget. We offer a prompt fix and credit in the advisory and the
commit, unless you would rather stay anonymous.

Please give us a reasonable window to ship a fix before disclosing publicly.
