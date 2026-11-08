# Self-host weave: choose your door

weave on a laptop binds `127.0.0.1` and needs no login. weave on a server needs a door: something that decides who gets to the port. The rule this page and the ones after it follow: **the authentication surface is the operator's choice.** Two doors, each a complete path on its own page, each ending with a check you can run.

`requireAuth` is the switch inside weave (`weave workspace require-auth`). With requireAuth on, every page and API call needs a token: a `wv_` bearer for agents, a session for people who sign in through the provider (door C). Off, whoever reaches the port is an architect. A door in front of the port is what makes "reaches the port" mean something.

## The two doors

| Door | Runs where | Code in weave | Phone browser | Agents over HTTP | Share links | Portability |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Edge gate**: Cloudflare Access, Tailscale, Caddy `basic_auth`, oauth2-proxy, Authelia | In front of the process | None | Yes (Tailscale needs its app) | Service token or tailnet member | Only behind a public gate | Swap the proxy; weave untouched |
| **C. Identity provider over OIDC**: Clerk, Auth0, Google; Keycloak, Authentik | Inside weave, identity outside | Ships with weave, zero dependencies | Yes | `wv_` bearer tokens | Share grants | One client id per provider |

**Door A** is the fastest way to a private instance today and costs nothing: every gate on the list has a free tier, and Cloudflare Access is free to fifty users. The gate owns identity; weave never learns who came in. Stack it in front of C whenever you like; neither side needs to know. The **Door A: an edge gate** guide has one config block per gate.

**Door C** signs people in with one OpenID Connect provider: Clerk, Auth0, Google, or a self-hosted identity server. The provider proves who is there; weave keeps the account, the role, the browser session and the `wv_` tokens agents use. The **Door C: sign in with a provider** page covers the provider's settings, the four variables, linking an account, sessions and `WEAVE_ORIGIN`.

## Door B was removed

weave used to ship a third door, B: passkeys built into weave, registered from a one-time invite link. It was removed in the 0.4 series, in the first release after 0.4.52 (Feature #243). The CLI verbs `weave account invite` and `weave account remove-credential` and the `/api/auth/register/*` and `/api/auth/login/*` routes went with it. A passkey already stored on an account record stays in the data and is ignored. To keep a person signing in, link their account to a provider identity before you upgrade: `weave account link <name>` prints an invite link for them.

## Tailscale, stated plainly

Tailscale is the simplest door A and the most limited: no public URL. Hosted MCP from claude.ai, share links opened off the tailnet, and phone capture from outside all stay off. Right for one person and their devices; wrong the day someone outside the tailnet needs a link.

## Where the door goes

Every deploy target (Railway, Fly.io, Render, a VPS, Docker on a NAS) takes the same container and the same environment (the **Environment reference** guide). The door sits between the internet and the published port: a platform's custom domain plus a gate, or a reverse proxy on the same box. Pick the target in **Deploy: Railway** or **Deploy: Fly.io, Render, a VPS, Docker**, then pick the door.

## How you know it worked

1. Open the instance in a private browser window. A door A gate asks you to sign in before any weave page draws. With requireAuth on and no gate, the page loads but every call answers `401` until a token is set.
2. `curl -s https://weave.example.com/api/health` still answers `{"ok":true,…}` through a public gate that exempts it, or a `302` to the gate's login when it does not. Either is fine; a bare `200` with your data behind it and no gate is the failure.
3. From a device that should not have access, the same URL gets the gate, not weave.