# Deploy: Fly.io, Render, a VPS, Docker

Four targets, the same container and the same environment. The constraint every one satisfies: weave writes one SQLite file per workspace in WAL mode through Node's synchronous driver, so it needs a real Node ≥ 22.16 process, a disk that survives restarts, and exactly one running copy per data directory. Serverless runtimes and horizontal scaling are out.

## Fly.io

The repo carries `fly.toml`: one Machine, a volume at `/data`, the internal port `4400`, a health check on `/api/health`, and `auto_stop_machines = "off"` so the single writer never sleeps mid-WAL.

```bash
fly launch --no-deploy --copy-config            # takes fly.toml as is; pick the app name and region
fly volumes create weave_data -r <region> -n 1 -s 2
fly secrets set WEAVE_KEYSTORE_PASSPHRASE=<long random string>
fly deploy --ha=false                            # one Machine, not two: one volume, one writer
```

Fly snapshots the volume daily with five days of retention; that is a floor, not a backup plan (the **Backup and restore** page). If the log shows `EACCES` on `/data`, the mount came up root-owned: `fly ssh console -C "chown node:node /data"` once, then `fly machine restart`.

**Check:** `fly status` shows one Machine `started`; `curl -s https://<app>.fly.dev/api/health` answers `{"ok":true`; a record created before `fly machine restart` is there after it.

## Render

New → **Web Service** → your repo, runtime **Docker**. Disks need a paid instance type. Under **Disks** add one at mount path `/data` (1 GB is plenty to start). Under **Environment** set `WEAVE_DATA=/data/workspace.db` and `WEAVE_KEYSTORE_PASSPHRASE`; Render sets `PORT`. Health check path: `/api/health`.

A disk pins the service to one instance and turns off zero-downtime deploys: Render stops the old instance before starting the new one, so each deploy is a few seconds of `502`. Render snapshots the disk daily and keeps snapshots at least seven days.

**Check:** the service log ends in `Weave running at http://…:<port>`; `/api/health` on the `onrender.com` URL answers ok; a record survives **Manual Deploy → Deploy latest commit**.

## A VPS (Hetzner, or any Linux box) with systemd

Any always-on Linux box with **Node ≥ 22.16**. There is nothing to build and nothing to install from npm.

```bash
sudo git clone https://github.com/grunion-ai/weave /opt/weave
sudo useradd --system --home /var/lib/weave --create-home weave
```

```ini
# /etc/systemd/system/weave.service
[Unit]
Description=weave
After=network.target

[Service]
User=weave
WorkingDirectory=/opt/weave
Environment=WEAVE_KEYSTORE=/var/lib/weave/keystore.json
ExecStart=/usr/bin/node /opt/weave/bin/weave.js serve --port 4400 --data /var/lib/weave/workspace.db
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now weave
```

Keep it bound to `127.0.0.1` (the default) and put a **Door A: an edge gate** in front: Caddy for a public hostname, Tailscale for a private one. Everything worth keeping is in `/var/lib/weave`. Update with `sudo git -C /opt/weave pull && sudo systemctl restart weave`; there is no migration step.

**Check:** `systemctl status weave` is `active (running)`; `curl -s http://127.0.0.1:4400/api/health` answers ok on the box; the gate's own check passes from outside.

## Docker (a NAS, a home server, Unraid, anywhere)

The repo carries `compose.yaml`: one service built from the `Dockerfile`, a named volume at `/data`, the port published on `4400`, a health check on `/api/health`.

```bash
git clone https://github.com/grunion-ai/weave && cd weave
docker compose up -d
```

To keep the data in a directory you can see instead of a named volume, change the mount to `./data:/data` and `chown 1000:1000 data` first: the image runs as the unprivileged `node` user (uid 1000) and a bind mount keeps the host's ownership. Set `WEAVE_KEYSTORE_PASSPHRASE` in the `environment` block to keep the keystore key off the disk. Update with `git pull && docker compose up -d --build`.

**Check:** `docker compose ps` shows the service `healthy`; `curl -s http://127.0.0.1:4400/api/health` answers ok; `docker compose restart` keeps every record.

## How you know it worked

Whichever target: `/api/health` answers `{"ok":true,…}` with the version you deployed, a record created before a restart is there after it, and the log shows no `EACCES` on the data directory. Then pick the door on the **Self-host weave: choose your door** page.