# Door C: sign in with a provider

Door C signs people in with one OpenID Connect (OIDC) provider. The provider has to serve `/.well-known/openid-configuration`; Clerk, Auth0, Keycloak, Authentik and Google are examples. The provider proves who is there; weave keeps the account record, the browser session and sign-out. Agents keep using `wv_` bearer tokens.

## Accounts and identities

Signing in at the provider creates no account in weave. An architect either invites a new person to a workspace (below, **Invite a new person**), which makes the account when they sign in, or links an existing weave account by minting an invite: a one-time link that lasts 7 days. The person opens it and signs in at the provider, and weave stores the provider's issuer and subject (the `sub` claim) on the account as an identity. From then on the subject alone signs that person in.

weave asks the provider for the `openid`, `email` and `profile` scopes (Feature #290 for the email claim, Issue #935 for the name). It keeps one email address per sign-in identity, and only when the provider marks it verified. It reads the profile name to name the account a person creates at the start page, and never stores a picture or any other profile claim. The address lets the start page list the invites waiting for a person as soon as they sign in, gives notification email a recipient, and shows architects who each member is in the **Invite people** dialog. A person sees their own address at `/api/auth/me`; deleting the account or unlinking the identity deletes it, and `weave export` leaves it out. An identity linked before this release gets its address at its next sign-in; nothing is guessed from old data.

A hosted provider with open sign-up lets anyone create a user there. A sign-in at the provider proves who someone is, and weave admits that person only after they have redeemed an invite for an account. weave keeps only the invite's hash, like a token or a session, and an invite works once.

## The Users table

**Users** is a system table in the System space, listed in the sidebar's System group under Workflows (Feature #318, Feature #333). Each account and each pending invite is a record with Name, Email, Role (Architect, Editor or Observer), Status (Invited or Active), Kind (Person or Agent), Avatar, Identities, Last Seen and Created. The accounts stay the source of truth and the records follow them, so an account made with `weave account create` or redeemed from an invite shows up here too.

You manage people by editing records. The **New user** form shows the Workspace the account will belong to, filled with the workspace you are in, so you see it before you create: a saved record's Workspace cannot move afterwards, and the token is shown once. The dialog that shows the token or the invite link names that role and workspace, as in **Architect token for net**. A new record with an Email invites that person at the record's Role; the answer carries the one-time sign-in link as `invite.url`, and the record reads Invited until they sign in. A new record with Kind Agent and no Email makes an agent account; the answer carries its `wv_` token as `token`, shown once. Editing Role changes the account's role without replacing its tokens or sessions; the last architect cannot be demoted. Editing Name renames the account, and deleting the record revokes the invite or deletes the account. Email, Status, Kind, Identities, Last Seen and Created are kept by weave and refuse edits.

Add your own fields to Users like on any table, and point a relation at it from any table in the same workspace for an owner or an assignee. Only an architect creates, edits or deletes Users records; editors and observers read them and relate to them. No record, query, export or MCP answer carries a token, session or invite hash, and `weave export` leaves the Email column out.

## Application at the provider

Register an OAuth or OIDC application that uses the authorization code flow with PKCE, the scopes `openid`, `email` and `profile` and one redirect URI:

```
<WEAVE_ORIGIN>/api/auth/oidc/callback
```

That URI serves every workspace the weave process hosts. Copy the client id and client secret.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `WEAVE_OIDC_ISSUER` | Yes | The provider's issuer URL. `https` is required except on loopback. |
| `WEAVE_OIDC_CLIENT_ID` | Yes | The client id of the application you registered. |
| `WEAVE_OIDC_CLIENT_SECRET` | No | The client secret. Omit it for a public client, which then relies on PKCE alone. |
| `WEAVE_OIDC_NAME` | No | The provider's name on the sign-in link. Defaults to the issuer's host name. |

Issuer and client id switch the door on together. Set one without the other and `weave serve` stops at startup and names the missing variable.

## Account linking

Link an account from the CLI, the HTTP API or MCP. Each takes the account name and answers with an invite: the code, its expiry and a `url` to send the person. From the CLI:

```bash
weave account link kyle
```

Add `--issuer <url>` when `WEAVE_OIDC_ISSUER` is not set in your shell. The CLI roots the link at `WEAVE_ORIGIN` and prints a bare path without it. The HTTP call needs an architect bearer token and answers with the full link:

```bash
curl -X POST https://weave.example.com/api/accounts/kyle/identities \
  -H "Authorization: Bearer wv_<architect token>" \
  -H "Content-Type: application/json" -d '{}'
# {"account":"kyle","issuer":"…","code":"wvi_…","expiresAt":"…",
#  "url":"https://weave.example.com/api/auth/oidc/start?invite=wvi_…"}
```

From MCP, call the `weave_accounts` tool with `action: link-identity`.

The invite link goes straight to the provider. After the person signs in there, weave pins their subject to the account and opens the workspace. A spent or expired link answers `410`; a provider identity that already opens another account answers `409` and leaves the invite unused. A person who signed in before an operator linked them sees **No account for this identity**; opening the invite link from that page links them in one step.

To unlink, name the subject that `weave account list` shows:

```bash
weave account unlink kyle --subject user_2abc
# or over HTTP: DELETE /api/accounts/kyle/identities?subject=user_2abc
```

An account linked by email before this release keeps any identity the provider had already pinned, minus the email. An identity that was never pinned is dropped on the first open, and the email is removed from the old identity entries in the audit log. Mint an invite for anyone who had not signed in yet.

## Invite a new person

An architect invites someone who has no account yet from the workspace's home page: choose **Invite** beside the workspace title, enter the email, pick the role (Editor, paid seat, by default; Observer, free; Architect, paid) and choose **Invite** or press Return. weave answers with a one-time sign-in link, which works once and expires in 7 days. When the operator has set `WEAVE_MAIL_KEY` and `WEAVE_MAIL_FROM`, weave emails the link to that address through Resend and the dialog says **Emailed**. Without them, or when the send fails, the dialog shows the link once: copy it and send it yourself. Below the form the same dialog lists the members and the pending invites, with the role, who invited and when, and **Revoke** cancels one.

The person opens the link and signs in at the provider, signing up there first if they have to. weave then makes their account at the invited role, named after the email's local part (`dylan@example.com` becomes `dylan`, then `dylan-2` when that name is taken), pins their subject to it, spends the invite and opens the workspace. Their next sign-in needs no link, and the link is not the only way in: a person who signs in at `/start` with a verified address that matches a pending invite sees it listed there and can accept it, which does the same thing. The audit log and `weave export` never carry the email; the account keeps the verified address the provider sent at sign-in.

An invite creates or links an account in the workspace it was made in. Access to another workspace requires an account there, with its own role. A link that was revoked, spent, expired or made in another workspace answers `410` before the provider; a sign-in with no invite and no membership gets the refusal page, **No access to** the workspace. Invalid-invite recovery offers ordinary sign-in or **Open workspace** for an existing member, plus **Find your workspaces**. It never grants access or redeems the invalid link again.

An architect sees the emails weave sends about an invite or a trial, filled with sample values, at `GET /api/mail/preview/invite`, `GET /api/mail/preview/trial` and `GET /api/mail/preview/trial-last`. Add `?role=observer`, `editor` or `architect` to pick the role, and `?theme=light` or `?theme=dark` to paint one palette instead of following the mail client's setting.

```bash
weave invite dylan@example.com --role observer   # prints the invite and its url
weave invite list                                # the pending ones
weave invite revoke <id>
# HTTP, with an architect token: POST /api/invites {"email", "role"}, GET /api/invites, DELETE /api/invites/<id>
# MCP: weave_accounts with action invite, invites or revoke-invite
```

## Clerk

In the Clerk dashboard, create an OAuth application and give it the redirect URI above. Use your Clerk instance's Frontend API URL as `WEAVE_OIDC_ISSUER`; on a development instance it looks like `https://<name>.clerk.accounts.dev`. weave accepts RS256 or ES256 id tokens and sends an S256 PKCE challenge; Clerk supports RS256 and S256.

```bash
WEAVE_OIDC_ISSUER=https://<name>.clerk.accounts.dev
WEAVE_OIDC_CLIENT_ID=<client id>
WEAVE_OIDC_CLIENT_SECRET=<client secret>
WEAVE_OIDC_NAME=Clerk
```

## Billing seats through Clerk

Editors and Architects take a paid seat; Observers read and comment for free. Billing stays off until two variables are set, and then weave reads each workspace's plan from Clerk Billing on every write by a paid account, cached for a minute.

1. In the Clerk dashboard, turn on Billing and connect the Stripe account that takes the money, then turn on Organizations.
2. Create one organization plan with per-seat pricing at $4.99 a seat each month, no base fee and no included seats. Note its slug.
3. Set the Backend API secret key, the publishable key and the slug on the server:

```bash
WEAVE_CLERK_SECRET_KEY=<sk_live_ key>
WEAVE_CLERK_PUBLISHABLE_KEY=<pk_live_ key>
WEAVE_BILLING_PLAN=<organization plan slug>
WEAVE_BILLING_SINCE=2026-10-16T00:00:00Z
```

Every workspace pays per seat on the one plan, from its first person on. An architect presses **Set up billing** on the **Billing** page (`/billing`), which makes one Clerk organization for the workspace and adds every Editor and Architect to it, then buys the seats in Clerk's checkout. Each Editor or Architect invited later takes another seat. Architects join with the role that may manage the organization's billing in Clerk, Editors as plain members, and Observers never join, so Clerk counts only paid seats. Invites, role changes, removals and leaving keep the organization in step.

A workspace made at `/start` opens on a free trial of `WEAVE_TRIAL_DAYS` days (14 unless the operator sets it; `0` turns trials off). During the trial every Editor and Architect works fully, writes and the AI app included, and weave asks Clerk only to notice a plan bought early. The sidebar shows how long is left over the last 3 days and links to **Billing**. A person away from the app hears by email: three days before the trial ends weave writes to every Architect with a verified address, and writes again on the last day, each mail linking to **Billing**. Both go out once per workspace, and a plan bought during the trial stops them. When the trial ends nothing is deleted: the rules below apply, and the records stay.

A paid account without a seat works as an Observer. Its writes answer `402` with `code: "seat-required"` and the billing page's address, worded for the reader: an Architect is told to subscribe, an Editor to ask an architect. The app shows one toast with **Open billing** however many writes it refused. Reading and commenting keep working, and so does an unseated Architect's AI app: `/mcp` answers `initialize`, `tools/list` and the read tools, and any write tool comes back as a tool error carrying the same words and the billing address. A failed card never cuts access: an item that is past due, or that Clerk ended after a failed payment nobody canceled, still seats its workspace. A canceled plan runs to the end of the month already paid. A workspace created before `WEAVE_BILLING_SINCE` is never billed. Accounts with no sign-in identity at Clerk, such as a deploy token's account, are not seats. When Clerk does not answer, a write answers `503` with `code: "billing-unavailable"` after the last answer is 15 minutes old.

`GET /api/billing` returns the plan (`trial` during one), `trial: { endsAt, daysLeft }` or `null`, the seat count and each member's seat; `POST /api/billing/organization` sets up the workspace's billing organization and needs an architect. An architect also reads each member's verified address, as in the Invite people dialog, and the Billing page prints it under the name so the page says who holds which seat. A member who is no architect reads the seats without any address.

With billing on, a person with no account can start a workspace of their own. Signing in at the start page, or at a workspace that answers **No access**, holds the login at `/start`, which offers **Create workspace**. The new workspace makes that person its Architect, linked to the login they signed in with, and the workspace starts its free trial, so they create and edit from the first minute. After the trial they work as an Observer there until they buy its first seat on its **Billing** page. Each login gets one unpaid workspace: while a workspace that login is Architect of has no plan, trial or not, another create answers `402` with `code: "plan-required"`, `waiting` naming that workspace and `billing` its billing page, and once a seat is bought there the next create goes through. `GET /api/start` says so before anyone types: `waiting` beside `canCreate` names the workspace, or is `null`, and each workspace record carries its `trial`. A record's `open` link with `?to=billing` lands on that workspace's billing page. An unavailable Clerk response makes creation answer `503` with `code: "billing-unavailable"` rather than letting the workspace through. Workspace creation follows the server's signup policy; being an Architect in another workspace grants no exception. The agent step counts an AI app as connected only once weave has answered one of its MCP calls, never a call it refused.

## Production service status

[System status](https://weave.grunion.ai/status) reports production web, API, and MCP availability without requiring sign-in. The [independent status page](https://weave-status.adriany.workers.dev) remains available if the application host cannot serve pages.

An external monitor checks each service once per minute. MCP checks authenticate to a dedicated empty monitoring workspace and validate initialization. The page shows observed uptime across a 90-day window, response times, and incident updates. Days without measurements remain unknown; a missing monitor heartbeat also marks current health unknown. Uptime is the proportion of successful checks, not a promise that every operation succeeded.

Two consecutive failed checks open an automatic incident. Two successful checks resolve it. Operators can publish investigation, identified, monitoring, and resolved updates. The page accepts no visitor incident submissions. Incident history begins when monitoring is enabled.

## Hosted setup

Website **Sign up** opens `/start?mode=signup`; **Sign in** keeps the sign-in form. The hosted rail's **New workspace** opens `/start?setup=new`, using the same creation eligibility and billing checks as the start page. Additional workspaces start with blank naming fields. **Create empty workspace** keeps the name and address you entered and waits for an available address, just like **Next**.

Empty and general setups appear before the template catalog. While searching, matching templates come first. Once creation finishes, **Open workspace** is available immediately; AI connection is optional, and desktop clients are under **More AI tools (desktop)**.

Setup keeps a draft in this tab's session storage for up to one day, scoped to the held sign-ins. Reload resumes the naming, work-selection or AI step. An interrupted create request is never replayed automatically: an existing workspace is reopened, otherwise the naming step asks you to check before continuing. Returning to the workspace picker discards the draft. Blocked storage still allows setup but cannot preserve a draft across reloads.

## Sign-in page

A signed-out visit to any page answers `302` to `/auth?next=<the page>`, and `/auth` goes straight to the provider, with no page in between, and keeps `?next`. After you sign in at the provider, you land on the page you were heading to. Signed in, `/auth` shows your sessions and a sign-out button. Signing out lands on `/auth?signed-out=1`, which shows a `Sign in with <name>` link instead of sending you back to the provider, where its own session would sign you straight back in. A refused sign-in gets a page that states the reason and links back to `/auth?signed-out=1`, never to bare `/auth`, which would send you to the provider and back to the same refusal. When the provider signs in someone with no account here, the page says that provider account has no access to the workspace, points to an invite link, and offers **Use a different account**: the provider's `end_session_endpoint` when its discovery document names one, coming back to `/auth?signed-out=1`, or else a new sign-in with `prompt=login`, so the provider asks for credentials again instead of reusing its session. An invite opened as someone the server already knows gets the same button, and that new sign-in carries the unspent invite. With billing on, the **No access** page also offers **Start your own workspace**, which opens the start page with that login held.

## Your account and signing out

The identity panel at the foot of the sidebar shows who you are signed in as in this workspace: your initials, your account name and your role here, as a chip. It never shows an email address. A walled workspace you are signed out of shows **Sign in** there instead, and an open workspace with nobody signed in shows Open access. The dots button beside the panel opens **Your menu**, which holds both ways to sign out:

- **Sign out**, whose tooltip reads **Sign out of <workspace>**, ends this workspace's session only and lands on its `/auth?signed-out=1`. Every other workspace in the rail stays signed in.
- **Sign out everywhere** ends every session this browser holds in one request, `POST /api/auth/logout?everywhere=1`, clears the held start login and the rail, and lands on the sign-in page.

Each workspace checks its own account and session. Signing out of one workspace leaves sessions in other workspaces open. **Sign out everywhere** ends the browser's sessions across the workspaces it has used. The shared documentation workspace can grant signed-in visitors Observer access to its guides.

Idle expiry works one workspace at a time too. A session you leave unused for 30 days ends on its own in that workspace only; the sidebar then shows **Sign in** there, and the rest stay signed in.

## Sessions and the lost-device day

Each workspace keeps its own session in this browser, carried in an `HttpOnly` cookie named `wv_session_<workspace id>`; only its hash is stored. A session lasts 30 days from its last use, and each use renews the cookie, so a workspace you open every day stays signed in while one you leave for 30 days signs out on its own, without touching the others. **Sign out of <workspace>** on `/auth` ends that workspace's session only; **Sign out of every workspace** ends every session this browser holds (`POST /api/auth/logout?everywhere=1`). From the same page you can end your other sessions in this workspace. When an architect removes your account, your sessions there end at once and the next visit shows a page saying your access was removed. A plain `wv_session` cookie from before per-workspace sessions opens nothing: the next response clears it, and a browser that held only that cookie signs in again.

When a device is lost, end its sessions from any terminal that holds the data, then deal with the provider account at the provider:

```bash
weave account sessions kyle                     # what is signed in, and from where
weave account revoke-session kyle --all         # every session ends now
```

Every step lands in the audit log: `identity-invited`, `identity-linked`, `identity-unlinked`, `session-created`, `session-revoked`. An architect `wv_` token is the rescue path, and `weave account` runs on the data file without a server.

## `WEAVE_ORIGIN` and `WEAVE_TRUST_PROXY`

The provider sends the browser back to `<WEAVE_ORIGIN>/api/auth/oidc/callback`, so the server has to know its own public origin. Set `WEAVE_ORIGIN` to the URL browsers use: `https://weave.example.com`, scheme and host, no path. It is required whenever `requireAuth` is on and the host is not loopback; `weave serve` refuses to start without it. The session cookie is `Secure` when it is https. On localhost nothing is needed: the origin is `http://localhost:<port>`, and the sign-in page moves an address typed as `127.0.0.1` there.

Behind Railway, Fly, Render or any reverse proxy, set `WEAVE_TRUST_PROXY=1` so the rate limiter reads the client address from the last `X-Forwarded-For` entry, the one the proxy appended; entries a client sends ahead of it are ignored. Without it every visitor shares the proxy's address. Leave it unset when the process faces the network itself, or a client could forge the header. The limits: 10 sign-in starts a minute per address, 5 failed callbacks a minute.

## Workspace hosts: `WEAVE_BASE_DOMAIN`

Set `WEAVE_BASE_DOMAIN=weave.example.com` and every workspace also answers at `<slug>.weave.example.com`, where the slug is the workspace's address, the `name` that `/w/<slug>/` already uses. The apex keeps serving the default workspace, `/w/<slug>/` keeps working on every host, a slug nobody holds answers a plain `404`, and a host with two labels under the base is refused with `421`. Unset, nothing changes.

A slug is a DNS label: lowercase letters, digits and hyphens, 1 to 63 characters, no hyphen at either end. Sixteen names are reserved, among them `www`, `api`, `mcp`, `auth`, `clerk`, `weave` and `grunion`, and so is anything starting with `_` or `xn--`; the full list lives in `public/slug-core.js`. The docs workspace keeps the `weave` host it already holds. Renaming a workspace keeps its old slug as an alias: the old host answers `301` to the new one, and no other workspace can claim it. Create and rename answer `slug_taken` (`409`), `slug_reserved` or `slug_invalid` (`400`), and `GET /api/workspaces/slug?slug=<slug>` answers `available`, `taken`, `reserved` or `invalid` to a signed-in account, 60 checks a minute per address.

Sign-in stays on one callback, `<WEAVE_ORIGIN>/api/auth/oidc/callback`, so the provider needs no new redirect URI. A workspace host sends the browser to the apex to sign in; after the callback the apex sends it back with a single-use code that lasts 60 seconds and is kept only as its hash. The workspace host trades the code for its own session cookie, which has no `Domain` attribute and so never reaches another host. Each workspace keeps its own wall: an identity with no account there gets the same refusal as on the apex. The MCP door answers at `<slug>.weave.example.com/mcp`, and its protected-resource metadata names that host.

At the apex, `/start` is the way in once `WEAVE_BASE_DOMAIN` is set: it names no workspace until the person signs in at the provider, then lists every workspace that identity opens, each one opening at its own host, and offers **Create workspace** when the server's signup and billing policy allows it. The start page is the setup page: a left pane walks a new person through Account, Workspace, Template (the kind of work they track, which picks a starter template with sample records) and Agent (their AI app, its own steps, the workspace MCP address with a copy button and a first message to paste; the step turns green when that app first reaches the workspace over OAuth, and passes only connected or skipped), while the right pane carries the brand and weaves each table in as the workspace builds. The page opens on sign-in, with **Create an account** beside it; a first sign-in through Google or another single sign-on creates the account on the spot. Sign-in cannot be skipped. **Skip setup** on any later step makes an empty workspace and opens it, and `/start?setup=skip` does the same straight after sign-in for people who configure weave themselves. A sign-in that fails comes back to the pane with the reason. With `WEAVE_OPEN_SIGNUP=1` anyone who signs in may create workspaces, up to `WEAVE_SIGNUP_LIMIT` each (1 by default); without it the page tells a stranger the server is invite only. A browser at the apex root goes to `/start`, which opens the workspace used last on the page it last had open while the thirty-minute start cookie holds a login, unless an invite waits on the list. Once that cookie has lapsed, the root opens the first live workspace the `wv_rail` cookie names, on its own host. **Find my workspaces** opens the full list at `/start?pick=1`. An apex permalink to a record, table, space or share moves with a `301` to the host of the workspace that holds it, and to the default workspace's host when none does. The apex `/api` and `/mcp` keep answering for the default workspace, so scripts and connected MCP clients need no change.

One browser can hold several logins. The start cookie keeps every login signed in there for thirty minutes, `/start` lists the union of the workspaces those logins open and names the login that opens each one, **Add login** returns to the provider with its account picker and adds the result, and **Sign out** forgets them all. Every sign-in, at the apex or at a workspace, runs find my workspaces: weave asks each workspace on the instance whether the login has an account there and sets a `wv_rail` cookie for the whole base domain naming the ones that said yes, docs workspace aside. No workspace learns what the others answered, and no server record links the logins; the rail lives in that cookie. A workspace host draws the rail from it, with a grey dashed chip for each workspace it holds no session for, titled **<name>: session expired, click to sign in**; such a chip opens through the apex, which signs the person in there with whichever held login has the account. The rail's **+** button offers New workspace, Add login and Find my workspaces. An invite link opened in a browser that already holds a login shows **Accept as <login>** for each one, which binds the invite to that login with no trip to the provider, next to **Use another login**. A new device starts with the docs workspace alone and rebuilds the rail one sign-in at a time.

At DNS, add a wildcard CNAME for `*.weave` next to the apex record, DNS only, and add `*.weave.example.com` as a second custom domain on the service so the platform issues a wildcard certificate.

## Sign-in verification

On every sign-in, weave verifies the id token's signature (RS256 or ES256) against the provider's published keys, then checks the token's issuer, audience, expiry and nonce. Each sign-in carries a one-time state value that expires after five minutes, so a sign-in left open longer than that at the provider is refused. weave sets a cookie in the browser that starts a sign-in and refuses a callback that arrives without it, so a callback link opened in another browser signs nobody in. weave reads the issuer and the subject from the id token and nothing else; it never calls the provider's userinfo endpoint.

## Agents sign in through the browser: the MCP door

With a provider configured, an agent on a hosted instance needs no pasted token. `/mcp` serves the default workspace over MCP and `/w/<name>/mcp` serves another; both speak what `POST /api/mcp` speaks. Add it to Claude Code in one line:

```bash
claude mcp add --scope user --transport http weave https://weave.example.com/mcp
```

The first call opens the provider's sign-in in the browser (in Claude Code, `/mcp` then Authenticate); Codex runs `codex mcp login weave`. The client stores and refreshes the token. Behind the line, weave is an OAuth 2.1 protected resource as the MCP authorization spec describes:

1. A call with no credential answers `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"` (`.../oauth-protected-resource/w/<name>/mcp` for a workspace). The body is JSON, except for a browser: a `GET` whose `Accept` prefers `text/html` gets a page naming the workspace, its MCP address with a copy button and the steps for Claude Code, Claude.ai and ChatGPT, under the same header.
2. That document (RFC 9728) names `WEAVE_OIDC_ISSUER` as the authorization server. The client registers itself there and signs the person in, so the provider must allow dynamic client registration (in Clerk: OAuth applications, dynamic client registration on).
3. The client sends the provider's access token. weave asks the provider's `userinfo_endpoint` who it belongs to and opens the account that subject is linked to on the requested workspace, the same lookup a browser sign-in makes. weave reads the subject alone and advertises `profile offline_access`: profile identifies the caller through userinfo, and offline access lets the connector renew its token without another sign-in. Configure the provider to grant these scopes to dynamically registered clients. Clerk grants them by default; an openid request can fail with invalid_scope when the client registered without it. Answers are kept a minute under the token's sha256; the token itself is never stored or logged.

Existing access and refresh tokens still identify the caller, but the requested workspace must hold an account linked to that identity. An account in the former hub root grants access only to its own workspace. If reconnecting returns `invalid_scope` because the client cached an older registration, remove and add that connector once so it registers with the advertised scopes. The browser sign-in keeps its own OIDC scopes.

A subject no account is linked to gets `403`: the person opens their invite (`weave account link <name>`) in a browser once, which pins the subject, and the agent's next call goes through. A token the provider rejects or has expired gets `401` with the same `WWW-Authenticate` header, and the client signs in again. Five refused tokens in a minute from one address get `429` for the rest of that minute, since each unknown token costs a call to the provider; a provider that is down gets `502`. Any role connects, as on `/api/mcp`, and `tools/list` names only the tools that role may call. Writes record `<account> via MCP`, never the access token's client id, and Created By and Modified By show the person chip with `via MCP` beside the name. A `wv_` token works on `/mcp` unchanged and never reaches the provider; `/api/mcp` accepts only `wv_` tokens and sessions.

Every tool in `tools/list` carries MCP annotations: a `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. Reads are read-only; deletes, bulk edits and whole-object replacements are destructive; reads, updates, sets, deletes and restores are idempotent, so a client may retry them, while creates, appends, imports of rows, comments, undo, token or link mints and `weave_call` are not; only the automation tools reach outside the workspace, since a rule can call a webhook. `/docs` lists every tool with its marks and `/support` names the contact address; both answer without sign-in. Set `WEAVE_OPENAI_APPS_CHALLENGE` to the token the ChatGPT apps directory issues and `/.well-known/openai-apps-challenge` answers it as plain text, also without sign-in; unset, that path is a 404.

The resource names an origin weave was told about: `WEAVE_ORIGIN`, or one of the comma-separated `WEAVE_MCP_ORIGINS` when the request arrived on that host (`https://mcp.weave.example.com` on the same service). A Host header weave was not told about is refused before it reaches the door.

## Limits

weave supports one provider per process and creates no account at sign-in. Signing out ends the weave session and leaves the provider's own session alone.

The MCP door does not check that a token was issued for this instance (RFC 8707 resource indicators): Clerk does not bind its tokens to a resource, so any access token the provider issued to any of its clients passes userinfo. The account link is what decides who gets in. Only the provider identity is cached for a minute. Every request checks the current account link and role, so demoting an account or revoking its link takes effect on the next request.

## How you know it worked

1. Open `/auth` in a private window: the browser goes straight to the provider's sign-in.
2. Open an invite link from `weave account link <name>` and sign in at the provider: you land in the workspace.
3. Sign in at the provider as someone with no invite: weave answers `403` with a page reading **No access to <workspace>** that offers **Use a different account**.
4. Run `weave account list`: the account's entry in `identities[]` carries the issuer and the `subject`, and no email.
5. `weave account revoke-session <name> --all`: the next page load in that browser is the sign-in page.