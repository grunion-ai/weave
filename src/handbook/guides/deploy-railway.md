# Deploy: Railway

One service, one volume, one replica. The repo carries `railway.json` (Dockerfile build, health check on `/api/health`, restart on failure, `numReplicas: 1`, `requiredMountPath: /data`), so the dashboard has little left to set.

## 1. Project from GitHub

New Project → **Deploy from GitHub repo** → your fork of `grunion-ai/weave` (or the repo itself). Railway reads `railway.json`, builds the `Dockerfile`, and deploys on every push to the branch you pick. Nothing to build, nothing from npm.

## 2. Volume at /data

Right-click the service → **Add Volume** → mount path `/data`. Everything worth keeping lives there: `workspace.db`, the `weave.db` docs workspace beside it, `files/` for attachments, and the keystore. A volume attaches to one service, and replicas cannot be used with a volume, so the count stays at `1`, which is also what a single SQLite writer needs.

Railway mounts the volume owned by root, and the image runs as the unprivileged `node` user, so the first deploy log reads:

```
weave: error: the data directory '/data' is not writable as uid 1000, so weave cannot open '/data/workspace.db' (unable to open database file). Give it to the user weave runs as, or on Railway set RAILWAY_RUN_UID=0 on the service and redeploy.
```

Set `RAILWAY_RUN_UID=0` on the service and redeploy; the process then runs as root inside its own container, which is the platform's documented answer.

## 3. Variables

Service → **Variables**. Railway sets `PORT` itself; the Dockerfile sets `WEAVE_HOST`, `WEAVE_DATA` and `WEAVE_KEYSTORE`; set the rest here.

```
WEAVE_DATA=/data/workspace.db
WEAVE_KEYSTORE_PASSPHRASE=<a long random string, kept in your password manager>
```

`WEAVE_KEYSTORE_PASSPHRASE` is what keeps the keystore key off the volume; lose it and the secrets in the keystore are unreadable (the data is untouched). `WEAVE_ORIGIN=https://weave.example.com` (the custom domain from step 4) and `WEAVE_TRUST_PROXY=1` join the list once `requireAuth` is on and you use **Door C: sign in with a provider**; `WEAVE_BACKUP_DEST` (with the bucket credentials) switches on the nightly backup — the **Backup and restore** guide. The **Environment reference** guide has every variable and what breaks when each is wrong.

## 4. Custom domain

Service → **Settings → Networking → Custom Domain** → `weave.example.com`. Railway shows the target; at your DNS add a **CNAME** record for `weave` pointing at it. At Cloudflare keep the proxy **off** (DNS only) so Railway's certificate check sees the record. TLS is Railway's.

## 5. Health check and restarts

`railway.json` carries `healthcheckPath: /api/health` and `healthcheckTimeout: 120`: a deploy is live only once `/api/health` answers `2xx`, and a crash restarts the container up to ten times. Health checks run at deploy time, not continuously; for an alert when the instance is down, point a free uptime monitor at `/api/health`.

## 6. The door

The custom domain is public. Turn `requireAuth` on (`weave workspace require-auth` from a shell on the service, or `PATCH /api/workspace` with `{"requireAuth": true}` and an architect token) and put a door in front: **Door C: sign in with a provider** (set `WEAVE_ORIGIN` to the custom domain, `WEAVE_TRUST_PROXY=1` and the `WEAVE_OIDC_*` variables, then `weave account link` from a shell on the service) or **Door A: an edge gate**. Once `WEAVE_ORIGIN` is set, or the default workspace requires sign-in, every workspace the instance creates starts with `requireAuth` on: with a base domain each one answers at a guessable `<slug>.<domain>` host. Turn it off only on a workspace you mean to publish.

## 7. Updates in place

A volume-backed service runs one deployment at a time, so every Railway redeploy stops the old container before the new one answers: a minute or more of failed requests. weave updates itself instead. Service → **Settings → Deploy → Custom Start Command** `node bin/weave.js supervise`, and under **Variables** `WEAVE_AUTO_UPDATE=1`. Redeploy once to install the supervisor; that deploy has the usual short gap, and it is the last one a release needs.

The supervisor holds `PORT` and runs `weave serve` as a worker behind it. Every ten minutes it asks GitHub for the latest release. A newer one is taken only when its tag's commit is on `grunion-ai/weave` main; it is unpacked to `/data/releases/v<version>/`, started as a second worker on the same workspace files, and checked on its own `/api/health`. Healthy, it takes new requests; the old worker finishes the ones it holds and exits; then the new one writes its migrations, and writes that arrive in that moment wait in the supervisor instead of failing. A release that fails any step stays off, the old worker keeps serving, and that version is not tried again. A restart boots the newest release on the volume that finished a swap. Railway still has to rebuild for a change to the Node version, the `Dockerfile` or the supervisor itself, and only then: with the supervisor in place, a redeploy to ship a landed change restarts the container, fails requests for up to a minute and resets the supervisor. The release tag is the deploy. If the service is connected to GitHub with automatic deploys, turn them off under **Settings → Source** so a push to main does not restart it.

## Backups

Railway's cron is a separate service and cannot share the volume, so backup runs inside the weave process, not as a Railway cron: phase 3 adds `weave backup` and the in-process nightly switch (`WEAVE_BACKUP_DEST`). Until then the **Backup and restore** page has the manual copy, and paid Railway plans snapshot the volume.

## How you know it worked

1. `curl -s https://weave.example.com/api/health` answers `{"ok":true,"name":"weave"}` (the same call with an architect token adds the version, build, sizes and backup state) and the Deployments tab shows the health check passed.
2. Create a record, then **Redeploy** from the dashboard. The record is still there: the volume, not the container, holds it.
3. The service shows **1 replica** and one volume at `/data`; the log has no `not writable` line for the data directory.
4. With step 7 in place, `/api/health` carries a `supervisor` object. After the next release it reads `"release":"v<that version>"` with `lastSwap.ok: true`, `version` is the new one, and the Deployments tab shows no new deployment.