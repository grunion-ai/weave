<p align="center">
  <img src="public/brand/weave-mark-light.svg" alt="weave" width="72">
</p>

<h1 align="center">weave</h1>

<p align="center">
  An open-source, self-hostable alternative to <strong>Airtable, ClickUp, and
  Fibery</strong> — tables, relations, workflows, formulas, and per-entity
  markdown documents, built to be <strong>agent-accessible</strong>, with zero
  runtime dependencies.
</p>

---

## Why

Work-management tools are built for humans first and APIs second. weave is built
for **humans and agents as equals**: everything the web UI can do, the REST API,
the CLI, and the MCP server can do too — same engine, same permissions, same
data file on your disk. No accounts, no cloud, no telemetry.

It is meant to **replace the SaaS your work already lives in** — Airtable's
bases and grids, ClickUp's tasks and boards, Fibery's connected databases with
documents and automations — running on your laptop or your own server, with no
per-seat bill and no vendor holding the export button.

- **Local-first** — your workspace is one SQLite file next to your project.
- **Yours to host** — one Node process and one file; run it on a laptop or a
  small VPS behind your own TLS and login (see [Self-hosting](#self-hosting)).
- **Zero dependencies** — `git clone` and run. Storage is Node's built-in
  `node:sqlite`; the only third-party code is vendored and pinned.
- **Agent-native** — an MCP server, a scriptable CLI, `Table#12` refs
  everywhere, and markdown documents addressable as plain URLs
  (`/e/Task#12/doc.md`, `.html`, `.pdf`).

## Quickstart (local)

Requires **Node ≥ 22.16** (Node 24 LTS recommended).

```bash
git clone https://github.com/grunion-ai/weave
cd weave
node bin/weave.js serve --port 4400 --data ./my-workspace.db
```

Open http://127.0.0.1:4400 — press **⌘K** to search everything. A
self-documenting **weave** docs workspace is provisioned alongside your data at
`/w/weave/`: handbook, wiki, the public issue tracker and roadmap, and a
Quality space mirroring the test suite.

## Self-hosting

A server install is the local install plus a front door. Any always-on Linux box
with **Node ≥ 22.16** will do — there is nothing to build and nothing to install
from npm.

**1. Run it as a service.** Keep it bound to `127.0.0.1`; step 2 is what the
network actually talks to.

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
ExecStart=/usr/bin/node /opt/weave/bin/weave.js serve --port 4400 --data /var/lib/weave/workspace.db
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now weave
```

**2. Put a front door on it.** weave has no accounts and no login of its own —
whoever reaches the port has full read/write on every workspace — so the proxy
or private network in front of it *is* the authentication. Pick one:

*Tailscale* — private to your devices, nothing exposed to the internet, no
certificate to manage. One command on the server:

```bash
tailscale serve --bg 4400
```

*Caddy* — a public hostname with automatic TLS and a shared password. Create the
hash with `caddy hash-password`, then:

```caddyfile
# /etc/caddy/Caddyfile
weave.example.com {
	basic_auth {
		you $2a$14$replace-with-your-bcrypt-hash
	}
	reverse_proxy 127.0.0.1:4400
}
```

Basic auth is one shared credential for everyone — weave has no per-user
permissions, so every person who gets in is an admin. If you need distinct
identities, put an SSO proxy (Cloudflare Access, oauth2-proxy, Authelia) in that
slot instead.

**3. Back up the data directory.** Everything lives in `/var/lib/weave`: one
`.db` per workspace (yours, plus the `weave.db` docs workspace provisioned
alongside it) and one `files/` directory of attachments.

```bash
for db in /var/lib/weave/*.db; do
	sqlite3 "$db" ".backup '/backups/$(basename "$db" .db)-$(date +%F).db'"
done
rsync -a /var/lib/weave/files/ /backups/files/
```

Use `.backup` rather than copying the file — it is safe while the server is
running and folds in the `-wal`/`-shm` sidecars. `node bin/weave.js export
--data <file>` writes the same workspace as human-readable JSON if you want a
copy you can read without weave.

**4. Update** with `git pull` — there is no migration step or build:

```bash
sudo git -C /opt/weave pull && sudo systemctl restart weave
```

## What's inside

| Area | Details |
| --- | --- |
| Data model | Spaces → tables → entities. Field types: text, number, date, date range, checkbox, url, email, select, multiselect, workflow states, bidirectional relations, lookups, rollups, formulas, and any number of markdown document fields per entity. |
| Views | Table, board, list, entity pages, a relation map with the automation layer drawn in, and per-space/table filtering. Inline editing everywhere. |
| Documents | Every doc is a native URL: `.md`, `.mmd`, `.html`, `.pdf`. Mermaid diagrams and raw HTML render in place; `[[Table#12]]` mentions resolve to links. Whole-entity export paginates one page per document. |
| Automations | Triggers (created / field changed / state changed) → set field, append doc, add comment, outgoing webhook. |
| Search | Universal ⌘K across workspaces with copyable permalinks, backed by a SQLite FTS5 index. |
| Storage | One workspace = one `.db` file (WAL, row-level writes, crash-safe). Legacy JSON workspaces migrate automatically; `exportJSON`/`importJSON` remain the human-readable interchange. CLI, server, and MCP can run concurrently. |
| Interfaces | Web UI (vanilla JS, no build step) · REST API · CLI (`bin/weave.js`) · MCP server (`weave mcp`). |

## Agents

```bash
# REST
curl -s localhost:4400/api/tables/Task/query -X POST -d '{"where":[["Status","=","Open"]]}'

# CLI
node bin/weave.js query Task --where '[["Status","=","Open"]]' --data ./my-workspace.db

# MCP (stdio)
node bin/weave.js mcp --data ./my-workspace.db
```

Entity refs accept UUIDs, `#12`, `Table#12`, or `Space/Table#12` everywhere.

## Development

```bash
node --test 'test/**/*.test.mjs'
```

The test suite is mirrored as entities in the docs workspace (Quality space),
and the roadmap + issue tracker live there too (`/w/weave/`) — the tool tracks
its own development.

## Third-party (vendored, pinned)

- [mermaid](https://github.com/mermaid-js/mermaid) 11.4.1 — MIT © Knut Sveidqvist & contributors
- [@tabler/core](https://github.com/tabler/tabler) 1.4.0 — MIT © Paweł Kuna & The Tabler Authors

## Security notes

weave has **no built-in authentication and no per-user permissions** — anyone who
can reach the port can read and write every workspace. The server binds
`127.0.0.1`, so a local install stays private to your machine; a self-hosted
install must sit behind a proxy or private network that does the authenticating
(see [Self-hosting](#self-hosting)). Never expose the port directly.

Documents may contain raw HTML, which renders same-origin — treat access to a
shared workspace the way you'd treat write access to a repo.

## License

MIT — see [LICENSE](LICENSE).
