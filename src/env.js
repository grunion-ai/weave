import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GUIDE_FILE = new URL('./handbook/guides/environment-reference.md', import.meta.url);

const INTRO = 'Every variable weave reads, its default, and what breaks when it is wrong. Precedence is the same everywhere: a CLI flag beats the environment, the environment beats the default. This page is rendered from `src/env.js`, and `test/env-registry.test.mjs` refuses a build where the code reads a variable that file does not list or the page has drifted from it.';

export const SECTIONS = [
  {
    id: 'deploy',
    heading: 'The deploy contract',
    intro: 'Every deploy target takes the same variables. The `Dockerfile` and `compose.yaml` in the repo name exactly this set; `test/deploy-artifacts.test.mjs` refuses a build where they and this table disagree.',
  },
  {
    heading: 'The container',
    text: 'The `Dockerfile` bakes the container-shaped values: `PORT=4400`, `WEAVE_HOST=0.0.0.0`, `WEAVE_DATA=/data/workspace.db`, `WEAVE_KEYSTORE=/data/keystore.json`. A platform overrides `PORT`; you supply `WEAVE_KEYSTORE_PASSPHRASE`. `WEAVE_ORIGIN`, `WEAVE_TRUST_PROXY`, `WEAVE_BACKUP_DEST`, `WEAVE_ALLOWED_HOSTS`, `WEAVE_FRAME_ANCESTORS`, `WEAVE_INLINE_FILE_TYPES`, `WEAVE_APPLET_PASSCODE`, the four provider sign-in variables, the two mail variables and `WEAVE_WEBHOOK_ALLOW_PRIVATE` are listed as comments, each off unless set, `WEAVE_UPDATE_CHECK` is listed as the one that is on unless set to `off`, and `WEAVE_AUTO_UPDATE` as the switch `supervise` reads, so the contract is visible in one place.',
  },
  {
    id: 'backup',
    heading: 'Backups',
    intro: '`WEAVE_BACKUP_DEST` in the deploy contract turns backups on. These decide how an archive is sealed, where it goes, and what a deployment that keeps archives for its accounts allows; the **Backup and restore** and **Backup to weave cloud** guides walk through both.',
  },
  {
    id: 'agents',
    heading: 'Agents and forms',
  },
  {
    id: 'applet',
    heading: 'The task applet',
    intro: '`WEAVE_APPLET_PASSCODE` in the deploy contract opens the applet at `/t`; these two decide what it lists and adds.',
  },
  {
    id: 'analytics',
    heading: 'Analytics',
  },
  {
    id: 'supervisor',
    heading: 'The supervisor',
    intro: '`weave supervise` with `WEAVE_AUTO_UPDATE=1` holds the port and swaps releases in place. These decide what it follows, how long it watches a new release before it keeps it, and when it declines to download one.',
  },
  {
    id: 'tracker',
    heading: 'Bug reports and the tracker',
    intro: 'For several weave servers that share one Development tracker: one server holds it, and the others forward the bug reports people file to it.',
  },
  {
    id: 'cli',
    heading: 'The CLI and the key store',
  },
  {
    heading: 'How you know it worked',
    text: '`curl -s http://<host>:<port>/api/health` answers with the workspace\'s name: a fresh volume answers `"workspace":"personal-workspace"`, and a workspace an earlier release created keeps the name it was given, such as `"workspace"`, the basename of `WEAVE_DATA`. A listing of the data directory shows `workspace.db`, `weave.db`, `files/` and `keystore.json`, and no `keystore.key` when the passphrase is set.',
  },
];

export const ENV = [
  {
    name: 'PORT', section: 'deploy', readBy: '`weave serve`', default: '`4400`',
    doc: 'The platform\'s router and health check probe a port nothing listens on: the deploy never goes live. Railway and Fly set it; leave it alone there.',
  },
  {
    name: 'WEAVE_HOST', section: 'deploy', readBy: '`weave serve`', default: '`127.0.0.1`',
    doc: 'Inside a container the loopback address is the container\'s own: the platform cannot reach the process and the health check fails. Containers need `0.0.0.0`; the `Dockerfile` sets it. On a VPS keep the default and let the gate connect on loopback.',
  },
  {
    name: 'WEAVE_DATA', section: 'deploy', readBy: 'every verb', default: '`~/.weave/workspace.json`',
    doc: 'Points off the volume: every restart starts empty. It names the workspace `.db`; the `weave.db` docs workspace and the `files/` directory of attachments are created beside it, so the directory is what needs to persist. A `.json` spelling is accepted and becomes the sibling `.db`.',
  },
  {
    name: 'WEAVE_KEYSTORE', section: 'deploy', readBy: 'every verb', default: '`~/.weave/keystore.json`',
    doc: 'A path means the file store at that path. Defaults into `$HOME`, which in a container is not on the volume: every restart loses the encrypted secrets. The `Dockerfile` sets `/data/keystore.json`. `file` or `keychain` picks the key store by hand; unset, a Mac with no key file at the default path uses the macOS keychain and everything else uses the file (the key field guide, Key store).',
  },
  {
    name: 'WEAVE_KEYSTORE_PASSPHRASE', section: 'deploy', readBy: 'every verb', default: 'unset',
    doc: 'Unset, a random key is written to a `chmod 600` file beside the keystore, so a copy of the volume carries the key. Set, the key is derived from the passphrase and nothing lands. Change it and every stored secret becomes unreadable; keep it in a password manager.',
  },
  {
    name: 'WEAVE_ORIGIN', section: 'deploy', readBy: '`weave serve`', default: 'unset (loopback: `http://localhost:<port>`)',
    doc: 'The public origin, scheme and host, no path. The identity provider sends sign-ins back to `<origin>/api/auth/oidc/callback`, and the `wv_session` cookie is `Secure` when it is https. Set, every workspace the server creates starts with `requireAuth` on. Unset off loopback with `requireAuth` on, `serve` refuses to start; wrong, the provider refuses the redirect URI or sends the browser to the wrong host.',
  },
  {
    name: 'WEAVE_TRUST_PROXY', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Set to `1` behind Railway, Fly, Render or any reverse proxy: the sign-in rate limits then read the client from the last `X-Forwarded-For` entry, the one the proxy appended. Unset behind a proxy, every visitor shares the proxy\'s address and ten sign-in attempts a minute lock everyone out; set with no proxy, a client can forge the header.',
  },
  {
    name: 'WEAVE_BACKUP_DEST', section: 'deploy', readBy: '`weave serve`, `weave backup`', default: 'unset',
    doc: '`s3://bucket/prefix`, or `weave://host/account` for a weave cloud account (the **Backup to weave cloud** guide). Set on `weave serve`, the server backs up in-process daily at 04:00 UTC and keeps thirty archives; unset, nothing leaves the machine and `/api/health` carries no `backup` field. Wrong bucket or credentials: the run fails, a `backup-failed` audit record and `lastStatus` on health say so, the server keeps serving. The endpoint, credentials and passphrase it needs are on the **Backup and restore** guide.',
  },
  {
    name: 'WEAVE_OIDC_ISSUER', section: 'deploy', readBy: '`weave serve`, `weave account link`', default: 'unset',
    doc: 'The issuer URL of one OpenID Connect provider, `https` off loopback. Set with `WEAVE_OIDC_CLIENT_ID`, `/auth` sends a signed-out browser to the provider (the **Door C: sign in with a provider** guide). Set without it, `serve` stops at startup and names the missing variable. A URL the provider does not call its own issuer fails every sign-in with a page that says so.',
  },
  {
    name: 'WEAVE_MCP_ORIGINS', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Other public origins the MCP door answers on, comma separated, each scheme and host only: `https://mcp.weave.example.com`. The protected-resource metadata names the one the request arrived on, else `WEAVE_ORIGIN`; each host is also served. Unset, a second domain on the same service gets `421`; wrong, the agent\'s client refuses the metadata because it names another URL (the **Door C: sign in with a provider** guide).',
  },
  {
    name: 'WEAVE_BASE_DOMAIN', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'The domain workspaces get their own hosts under: `weave.example.com` serves each workspace at `<slug>.weave.example.com`, host name only. Sign-in still finishes at `WEAVE_ORIGIN`. Unset, a workspace host gets `421`; wrong, the wildcard certificate does not cover the hosts browsers ask for (the **Door C: sign in with a provider** guide, section Workspace hosts).',
  },
  {
    name: 'WEAVE_OPEN_SIGNUP', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: '`1` lets anyone who signs in at the provider create a workspace from `/start` and own it. Unset, hosted signup is invite only unless billing allows a new workspace.',
  },
  {
    name: 'WEAVE_SIGNUP_LIMIT', section: 'deploy', readBy: '`weave serve`', default: '`1`',
    doc: 'How many workspaces one sign-in may create under `WEAVE_OPEN_SIGNUP`.',
  },
  {
    name: 'WEAVE_ALLOWED_HOSTS', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Extra Host names the server answers, comma separated, besides loopback and the host of `WEAVE_ORIGIN`: `weave.internal,10.0.0.5`. Any other `Host` header gets `421`, so a platform that probes by a name missing here sees its health check fail. With `WEAVE_ORIGIN` set, a page asked for on one of these names gets a `308` to the same path on `WEAVE_ORIGIN`, so sign-in always runs on the name its callback returns to; API, MCP and `/api/health` calls are served where they arrive. Unset, with `WEAVE_ORIGIN`, `WEAVE_MCP_ORIGINS` and `WEAVE_BASE_DOMAIN` unset too, a non-loopback bind answers any Host and warns once at start.',
  },
  {
    name: 'WEAVE_FRAME_ANCESTORS', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Other origins allowed to frame weave pages, comma separated, each scheme and host: `https://intranet.example.com`. They join `frame-ancestors \'self\'` in the Content Security Policy of every page. Unset, a weave page embedded in another site stays blank; wrong, the browser console names the refused ancestor.',
  },
  {
    name: 'WEAVE_INLINE_FILE_TYPES', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Attachment types served in place beside images, PDF and plain text, comma separated: `audio/mpeg,video/mp4`. Every other type downloads. A type listed here still arrives under `nosniff` and a sandbox policy, so a listed HTML type cannot run on the application origin.',
  },
  {
    name: 'WEAVE_APPLET_PASSCODE', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'A passcode the task applet at `/t` asks for before it opens; a right answer sets an unlock cookie, and eight wrong ones inside ten minutes answer `429` to every later attempt, the right passcode among them, until that window ends. Unset, there is no applet to reach: `/t` answers `404`.',
  },
  {
    name: 'WEAVE_OIDC_CLIENT_ID', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'The client id the provider issued for this instance. The provider must hold `<WEAVE_ORIGIN>/api/auth/oidc/callback` as a redirect URI, or it refuses the sign-in before weave sees it.',
  },
  {
    name: 'WEAVE_OIDC_CLIENT_SECRET', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'The client secret, for a confidential client. Unset, weave signs in as a public client and relies on PKCE alone; a provider that expects the secret answers `invalid_client`. `weave serve` checks the id and secret at start and every 15 minutes with a made-up code at the token endpoint; `/api/health` reads `auth.ok: false` and the provider\'s code when the provider refuses them.',
  },
  {
    name: 'WEAVE_OIDC_NAME', section: 'deploy', readBy: '`weave serve`', default: 'the issuer\'s host name',
    doc: 'The word on the sign-in link: `Clerk` reads "Sign in with Clerk".',
  },
  {
    name: 'WEAVE_MAIL_KEY', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'A Resend API key. Set with `WEAVE_MAIL_FROM`, an invite made from **Invite** or `POST /api/invites` is emailed to the address typed, one POST to `api.resend.com/emails`. Unset, or set without `WEAVE_MAIL_FROM`, weave sends no email and the invite answers its link to copy. A wrong or revoked key: the invite is still made, its answer says `mailed: false` with Resend\'s reason in `mailError`, and the server log says why.',
  },
  {
    name: 'WEAVE_MAIL_FROM', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'The sender, such as `weave <no-reply@mail.example.com>`, on a domain Resend has verified (its SPF and DKIM records in your DNS). An unverified domain: Resend refuses each send with `403`, which lands in `mailError` as above.',
  },
  {
    name: 'WEAVE_CLERK_SECRET_KEY', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'A Clerk Backend API secret key (`sk_live_`) for the instance that signs people in. Set with `WEAVE_BILLING_PLAN`, it turns billing on: weave reads each workspace\'s plan from Clerk Billing and mirrors its Editors and Architects into a Clerk organization. Unset, nobody is billed and every role works as before.',
  },
  {
    name: 'WEAVE_CLERK_PUBLISHABLE_KEY', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'The same instance\'s publishable key (`pk_live_`). The billing page loads Clerk\'s checkout with it; unset, the page shows the plan and seats but offers no way to pay. When its instance is the sign-in issuer, `/start` also mounts Clerk\'s sign-up and sign-in form in the setup page\'s left pane instead of sending people to Clerk\'s own page.',
  },
  {
    name: 'WEAVE_BILLING_PLAN', section: 'deploy', readBy: '`weave serve`', default: 'unset',
    doc: 'Slug of the one Clerk Billing organization plan, priced per seat. Every workspace pays per Editor and Architect from its first person on, and only members of its Clerk organization hold a seat. A paid human without a seat works as an Observer until an architect buys one.',
  },
  {
    name: 'WEAVE_BILLING_SINCE', section: 'deploy', readBy: '`weave serve`', default: 'unset (no workspace is exempt)',
    doc: 'A date such as `2026-10-16T00:00:00Z`. A workspace created before it is never billed and never asks Clerk. A value that is not a date stops the server at start.',
  },
  {
    name: 'WEAVE_TRIAL_DAYS', section: 'deploy', readBy: '`weave serve`', default: '`14`',
    doc: 'Length of the free trial a workspace made at `/start` opens on; every paid role works fully until it ends. `0` means no trial. A value that is not a whole number stops the server at start.',
  },
  {
    name: 'WEAVE_WEBHOOK_ALLOW_PRIVATE', section: 'deploy', readBy: 'every verb that fires a workflow', default: 'unset',
    doc: 'A webhook action posts only to a public address: before each delivery weave resolves the host and refuses loopback, link-local, the private ranges and the cloud metadata addresses, follows no redirect, and writes the refusal to the rule\'s **Health Reason**. Set to `1` on an instance whose webhooks land on its own network (a Railway private service, a VPS sidecar) and the ranges are allowed; redirects stay refused.',
  },
  {
    name: 'WEAVE_UPDATE_CHECK', section: 'deploy', readBy: '`weave serve`', default: 'on',
    doc: 'Set to `off` and the server makes no request to GitHub. On, it asks `api.github.com/repos/grunion-ai/weave/releases/latest` at most once a day (no token, nothing about the install), keeps the answer in `update-check.json` beside `WEAVE_DATA` (a new version asks again at boot, and never reports a latest release older than itself), and `/api/health` carries `latestRelease`, `releaseCheckedAt` and `releaseBehind`; the sidebar instance chip turns amber when a newer release exists. Offline, rate-limited or blocked, the check stays silent and nothing else changes.',
  },
  {
    name: 'WEAVE_AUTO_UPDATE', section: 'deploy', readBy: '`weave supervise`', default: 'unset',
    doc: 'Set to `1` and `weave supervise` holds the port, runs the server as a worker, and installs each newer release in place: every ten minutes it asks GitHub for the latest release, takes it only when the tag\'s commit is on `grunion-ai/weave` main, unpacks it to `releases/v<version>/` beside `WEAVE_DATA`, and moves requests to the new worker once its `/api/health` answers. Unset, `supervise` is `serve`. A release that fails its health check stays off and is not tried again; `/api/health` carries the supervisor\'s `release`, `dir`, `lastSwap` and `failed`. After every swap, every failed health check and every boot, the supervisor deletes the folders under `releases/` except the one it serves and the most recently served good one, kept for rollback; while the image serves, only the newest good folder stays. `releases/state.json` is never deleted, and a folder it cannot remove is logged and never stops a swap. A dev instance that follows main unpacks each commit to `releases/c<sha>/` under the same rule.',
  },
  {
    name: 'WEAVE_MAX_ROWS', section: 'deploy', readBy: '`weave serve`', default: '`500`',
    doc: 'The most records one API call returns when it names a `limit`: entity lists and queries, activity, audit, undo, document revisions and search clamp a larger `limit` to this, which is the most the UI ever asks for in one call. A call that names no `limit` is unchanged, except three that page themselves: the table query answers 200 records over the API and MCP, the activity feed its newest 500 over the API, MCP and CLI, and the audit log its newest 100 (`limit: -1` asks the API for the whole table or log, while MCP `weave_query` reads at most 2,000 records a call and pages on `nextOffset`; `total` counts every record, and the table query\'s `nextOffset` names the next page). Raise it for an agent that pages in bigger steps; every record is still built on the one event loop.',
  },
  {
    name: 'WEAVE_BACKUP_PASSPHRASE', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`, `weave workspace migrate`', default: 'unset (falls back to `WEAVE_KEYSTORE_PASSPHRASE`, then `keystore.key`)',
    doc: 'Seals each archive with AES-256-GCM under a key stretched from it. Unset, `WEAVE_KEYSTORE_PASSPHRASE` seals it, and without that the contents of `keystore.key`; with none of the three the archive is a plain tar, and a `weave://` destination is refused because the cloud keeps encrypted archives only. A restore needs the passphrase the archive was sealed with: a wrong one stops it with "Cannot decrypt the archive". Keep it somewhere that is not the server and not the bucket.',
  },
  {
    name: 'WEAVE_BACKUP_TOKEN', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`, `weave workspace migrate`', default: 'unset',
    doc: 'The `wv_` account token for a `weave://host/account` destination, printed once by `weave account create` on the deployment that keeps the archives. Unset, or not a `wv_` token, a `weave://` backup, restore or migration stops before it sends anything. A token the deployment does not know answers `401`; a token from another account than the one the destination names answers `403`.',
  },
  {
    name: 'WEAVE_BACKUP_KEY_ID', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset (falls back to `AWS_ACCESS_KEY_ID`)',
    doc: 'The access key id for an `s3://` destination or source, and for the bucket a deployment keeps its accounts\' archives in. Unset along with `AWS_ACCESS_KEY_ID`, every bucket call stops with "No bucket credentials"; a key the provider does not know fails the run, and on `weave serve` a `backup-failed` audit record says why.',
  },
  {
    name: 'WEAVE_BACKUP_SECRET', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset (falls back to `AWS_SECRET_ACCESS_KEY`)',
    doc: 'The secret key that goes with `WEAVE_BACKUP_KEY_ID`; every request is signed with it under AWS Signature Version 4. Unset along with `AWS_SECRET_ACCESS_KEY`, every bucket call stops with "No bucket credentials"; a wrong secret fails every signed request.',
  },
  {
    name: 'WEAVE_BACKUP_ENDPOINT', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset (AWS S3)',
    doc: 'An S3-compatible endpoint for R2, B2 or MinIO, addressed path-style as `endpoint/bucket/key`: `https://<account-id>.r2.cloudflarestorage.com`. Unset, requests go to AWS S3 in `WEAVE_BACKUP_REGION`. Wrong, every request reaches a host that does not hold the bucket and the run fails.',
  },
  {
    name: 'WEAVE_BACKUP_REGION', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: '`AWS_REGION`, else `auto` with an endpoint and `us-east-1` without',
    doc: 'The region every request is signed for. R2 takes `auto`; B2 wants its real region, such as `us-west-004`. A region the provider does not accept fails every signed request.',
  },
  {
    name: 'WEAVE_BACKUP_PART_BYTES', section: 'backup', readBy: '`weave serve`, `weave backup`', default: '`8388608` (8 MiB)',
    doc: 'The part size of a multipart upload. An archive larger than one part goes up a part at a time, so a backup holds one part in memory however large the archive is. S3 requires 5 MiB for every part but the last, so a smaller value is raised to that; a value that is not a positive number keeps 8 MiB.',
  },
  {
    name: 'WEAVE_BACKUP_BUCKET', section: 'backup', readBy: '`weave serve`', default: 'unset',
    doc: 'Makes this deployment keep backups for its accounts: the bucket the `/api/backups` doors store archives in, as `<account id>/<archive>`, reached with the key, secret, endpoint and region above. Unset, every door answers `400`: this deployment keeps no backups.',
  },
  {
    name: 'WEAVE_BACKUP_QUOTA_BYTES', section: 'backup', readBy: '`weave serve`', default: '`5368709120` (5 GiB)',
    doc: 'Each account\'s byte quota in that bucket. After each upload the oldest archives go until the account is under the quota and holds thirty at most, never the archive just stored; an archive larger than the whole quota is refused with `413`. A value that is not a positive number keeps 5 GiB.',
  },
  {
    name: 'AWS_ACCESS_KEY_ID', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset',
    doc: 'The standard AWS spelling of `WEAVE_BACKUP_KEY_ID`, read only when that is unset.',
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset',
    doc: 'The standard AWS spelling of `WEAVE_BACKUP_SECRET`, read only when that is unset.',
  },
  {
    name: 'AWS_REGION', section: 'backup', readBy: '`weave serve`, `weave backup`, `weave restore`', default: 'unset',
    doc: 'The standard AWS spelling of `WEAVE_BACKUP_REGION`, read only when that is unset.',
  },
  {
    name: 'WEAVE_MCP_TOOLS', section: 'agents', readBy: '`weave mcp`, `weave serve`', default: '`core`',
    doc: '`all` makes `tools/list` name every tool, for a client that wants each one in its picker; `weave mcp --tools all` does the same for one process. Anything else lists the core set, and `weave_call` runs the rest by name (the **Agent access (MCP)** guide).',
  },
  {
    name: 'WEAVE_OPENAI_APPS_CHALLENGE', section: 'agents', readBy: '`weave serve`', default: 'unset',
    doc: 'The token the ChatGPT apps directory issues to check that you control the domain. Set, `/.well-known/openai-apps-challenge` answers it as plain text without sign-in; unset, that path answers `404` and the directory\'s check fails (the **Door C: sign in with a provider** guide).',
  },
  {
    name: 'WEAVE_ANONYMOUS_FORMS', section: 'agents', readBy: '`weave serve`', default: 'unset',
    doc: '`1` or `true` lets a form whose floor is **Anonymous** take a submission from a signed-out visitor. Unset, that floor is not enough: a signed-out visitor is asked to sign in first (the **Forms** guide).',
  },
  {
    name: 'WEAVE_APPLET_TABLE', section: 'applet', readBy: '`weave serve`', default: '`Product/Task`',
    doc: 'The table the applet lists and adds tasks to, as `Space/Table`; its workflow field holds the states a task moves through. A table the workspace does not have: every list and every add answers `404`.',
  },
  {
    name: 'WEAVE_APPLET_DEFAULTS', section: 'applet', readBy: '`weave serve`', default: '`{}`',
    doc: 'A JSON object of field values every task the applet adds starts with, such as `{"Priority": "High"}`; the task\'s name and the values the applet sends win over it. A value that is not JSON is ignored and tasks start without defaults; a field the table does not have refuses every add with `404`.',
  },
  {
    name: 'POSTHOG_KEY', section: 'analytics', readBy: '`weave serve`', default: 'unset',
    doc: 'A PostHog project key (`phc_`). Set, the app and its sign-in pages show a cookie choice and record nothing until a visitor accepts; after that, events reach PostHog through weave\'s own `/ingest` path. Unset, or not a `phc_` key, no page loads PostHog and `/ingest` answers `404`.',
  },
  {
    name: 'POSTHOG_HOST', section: 'analytics', readBy: '`weave serve`', default: '`https://us.i.posthog.com`',
    doc: 'The PostHog host `/ingest` forwards to: `https://eu.i.posthog.com` for a project in the EU region. A host that does not hold the key\'s project records nothing.',
  },
  {
    name: 'WEAVE_TRACK', section: 'supervisor', readBy: '`weave supervise`', default: 'unset (tagged releases)',
    doc: '`main` follows every commit on `grunion-ai/weave` main, unpacked to `releases/c<sha>/`; `branch:<name>` follows another branch the same way, such as a `production` promotion branch. Unset, or any other value, the supervisor installs tagged releases only. A branch name with a character other than letters, digits, `.`, `_`, `-` and `/`, or with `..`, stops `supervise` at start.',
  },
  {
    name: 'WEAVE_DEPLOY_TOKEN', section: 'supervisor', readBy: '`weave supervise`, `weave serve`', default: 'unset',
    doc: 'A bearer token of 32 characters or more. With it, `POST /_supervisor/check` makes the supervisor check for a new release or commit at once, and `GET /_supervisor/workspaces` makes the worker list each workspace and whether it requires sign-in. Shorter or unset, neither path exists; a request with another token answers `401`.',
  },
  {
    name: 'WEAVE_WATCH_MS', section: 'supervisor', readBy: '`weave supervise`', default: '`600000` (ten minutes)',
    doc: 'How long the supervisor watches a release after it switches to it. The worker exiting, three failed `/api/health` polls in a row, or a share of 5xx answers at or above `WEAVE_WATCH_5XX_RATE` swaps back to the kept rollback folder, or to the image when none is kept. `0`, or a value that is not a number, turns the watch off: a release that passes its first health check is kept.',
  },
  {
    name: 'WEAVE_WATCH_5XX_RATE', section: 'supervisor', readBy: '`weave supervise`', default: '`0.25`',
    doc: 'The share of 5xx answers, over at least 20 proxied responses during the watch, that marks a release failed and swaps back. `1` trips only when every answer is a 5xx; above `1`, or a value that is not a number, no share trips the watch.',
  },
  {
    name: 'WEAVE_RELEASE_FREE_MB', section: 'supervisor', readBy: '`weave supervise`', default: '`128`',
    doc: 'The free space, in MB, the releases volume must have before the supervisor downloads a release. Under it nothing is fetched, `lastSwap.ok` is `false` with the free space in the reason, and the next check tries again; `/api/health` shows `supervisor.disk`.',
  },
  {
    name: 'RAILWAY_GIT_COMMIT_SHA', section: 'supervisor', readBy: '`weave supervise`', default: 'set by Railway',
    doc: 'The commit the image was built from. The supervisor gives the image that commit, so `/api/health` names it and a supervisor that follows a branch does not download the commit it already serves. Off Railway it is unset: the image has no commit, and the first check fetches the branch tip even when the image is that commit.',
  },
  {
    name: 'WEAVE_DEFER_MIGRATIONS', section: 'supervisor', readBy: '`weave serve`', default: 'unset',
    doc: 'Set to `1` by `weave supervise` on each worker it starts beside the serving one. That worker opens its workspaces without migrating them; the supervisor holds writes until the old worker has exited, then has it migrate. Only a worker the supervisor spawned reads it; never set it by hand.',
  },
  {
    name: 'WEAVE_TRACKER_CANONICAL', section: 'tracker', readBy: '`weave serve`', default: 'unset',
    doc: '`1` marks the server whose `weave` docs workspace holds the canonical Development tracker. Boot then skips the sync from the `docs/development.json` the build ships and logs one line saying so, and the server never forwards a bug report. Unset, boot updates the Development rows from that manifest, over edits made on this server.',
  },
  {
    name: 'WEAVE_BUG_FORWARD_URL', section: 'tracker', readBy: '`weave serve`', default: 'unset',
    doc: 'The workspace base of the canonical tracker: `https://weave.example.com/w/weave`. Set with `WEAVE_BUG_FORWARD_TOKEN`, `POST /api/bug-report` posts each report to `<url>/api/bug-report` with this server\'s origin as its instance and answers with the canonical row. A network error, a 10 s timeout or a refusal files the report here instead and answers `forward: "failed"`. Unset, or set without the token, reports stay on this server.',
  },
  {
    name: 'WEAVE_BUG_FORWARD_TOKEN', section: 'tracker', readBy: '`weave serve`', default: 'unset',
    doc: 'The bearer token the canonical server accepts for bug reports. A token it refuses files the report here instead, with that server\'s answer in `forwardError`.',
  },
  {
    name: 'WEAVE_ACTOR', section: 'cli', readBy: 'every verb', default: 'your login name, else `cli`',
    doc: 'The name the activity feed and audit log give each write a CLI verb makes, `weave mcp` over stdio included. Wrong, the history credits someone else. A request to `weave serve` carries its own caller instead.',
  },
  {
    name: 'WEAVE_KEYCHAIN', section: 'cli', readBy: 'every verb', default: 'the default keychain',
    doc: 'A keychain file the macOS keychain store reads and writes instead of the default one. Read only under the keychain store; a file `security` cannot open fails every credential read and write with the keychain\'s own message (the key field guide, Key store).',
  },
  {
    name: 'HOME', section: 'cli', readBy: 'every verb', default: 'set by the system',
    doc: '`~/.weave/` under it holds the default workspace and key store. In a container it is not on the volume, which is why the `Dockerfile` points `WEAVE_DATA` and `WEAVE_KEYSTORE` at `/data`.',
  },
];

const HEAD = ['| Variable | Read by | Default | What breaks when it is wrong |', '| --- | --- | --- | --- |'];
const row = (v) => `| \`${v.name}\` | ${v.readBy} | ${v.default} | ${v.doc} |`;

export function renderEnvironmentReference(env = ENV) {
  const sections = SECTIONS.map((s) => [
    `## ${s.heading}`,
    ...(s.intro ? [s.intro] : []),
    ...(s.text ? [s.text] : []),
    ...(s.id ? [[...HEAD, ...env.filter((v) => v.section === s.id).map(row)].join('\n')] : []),
  ].join('\n\n'));
  return ['# Environment reference', INTRO, ...sections].join('\n\n') + '\n';
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(GUIDE_FILE, renderEnvironmentReference());
  console.log(`${fileURLToPath(GUIDE_FILE)} rendered from src/env.js`);
}
