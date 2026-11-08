# Backup to weave cloud
A self-hosted weave can send its nightly archive to an account on a weave cloud deployment such as weave.grunion.ai. The archive is sealed on your machine with the passphrase you already use for **Backup and restore**, so the cloud stores ciphertext only and cannot read a record of it. The cloud runs the same code as your instance; nothing else needs installing.

## Send archives to the cloud
1. On the cloud deployment, mint a token for your account: `weave account create <name> --role editor` prints a `wv_` token once. Keep it with your other secrets.
2. On your instance, set three variables and restart `weave serve`:

| Variable | Value |
| --- | --- |
| `WEAVE_BACKUP_DEST` | `weave://<host>/<account>`, for example `weave://weave.grunion.ai/alice` |
| `WEAVE_BACKUP_TOKEN` | the `wv_` token from step 1 |
| `WEAVE_BACKUP_PASSPHRASE` | the passphrase that seals the archive (or `WEAVE_KEYSTORE_PASSPHRASE`, or `keystore.key` beside the data) |

The nightly run at 04:00 UTC then builds the archive, seals it and sends it with `PUT /api/backups/<archive>`. `/api/health` shows the run under `backup`, with `kind: "weave"` beside the destination. A one-off run is `weave backup --dest weave://weave.grunion.ai/alice`. A destination with no passphrase is refused before anything is built, because the cloud keeps encrypted archives only.

The host is reached over https; `localhost`, `127.0.0.1` and `[::1]` use http, for testing against a local server.

## Quota and retention
Each account keeps at most thirty archives and at most its byte quota, 5 GiB unless the deployment sets `WEAVE_BACKUP_QUOTA_BYTES`. After each upload the cloud deletes the oldest archives until both limits hold, and it never deletes the archive it just stored. An archive larger than the whole quota is refused with `413` and evicts nothing.

## Restore from the cloud
`weave restore --from weave://weave.grunion.ai/alice --data <dir>` pulls the newest archive, checks every entry against its manifest and unpacks it, the same as a restore from a file. Name an archive to take an older one: `weave restore --from weave://weave.grunion.ai/alice/<archive> --data <dir>`. The restore needs `WEAVE_BACKUP_TOKEN` and the passphrase the archive was sealed with.

## Migrate to a cloud workspace
A stored archive can become a workspace on the cloud. `weave workspace migrate --from weave://weave.grunion.ai/alice --name acme` takes the newest archive (name one with `/<archive>` at the end), sends the passphrase once, and the cloud creates the workspace `acme` from it: it decrypts the archive in a scratch directory, runs the same restore as `weave restore`, moves the workspace and its attachments into place and deletes the scratch directory. The passphrase is never written down or logged. The command reads it from `WEAVE_BACKUP_PASSPHRASE` or `--passphrase-env NAME`, and needs `WEAVE_BACKUP_TOKEN` from an Architect in the workspace receiving the migration request.

An archive of several workspaces needs `--workspace <name>` to pick one. Keystore secrets stay behind: set them again on the new workspace. The migration is one-way; the self-hosted instance keeps running and keeps backing up.

Over HTTP the same thing is `POST /api/workspaces` with `{ "name": "acme", "from": "backup:<archive>", "key": "<passphrase>" }`. A wrong passphrase answers `400` and creates nothing. An archive from another account is not found (`404`). Migrating the same archive twice answers `409`, because its workspace is already there.

## The doors
Every door needs `Authorization: Bearer wv_…` from an account on the deployment, and stores under that account only.

| Door | Answers |
| --- | --- |
| `GET /api/backups` | the account, its quota, the bytes used, and each archive with its size and time, oldest first |
| `GET /api/backups/<archive>` | the archive bytes |
| `PUT /api/backups/<archive>` | stores the body, prunes, and answers `201` with what it kept and pruned |

No token, or a token the deployment does not know, answers `401`. When the client names an account (the `<account>` in `weave://`, sent as `X-Weave-Account`) and the token belongs to a different one, the door answers `403`. Another account's archive is not found (`404`). A body that is not a sealed archive answers `400`.

## Running the cloud side
A deployment keeps backups once it has a bucket. It reads six variables:

| Variable | Meaning |
| --- | --- |
| `WEAVE_BACKUP_BUCKET` | the bucket name; unset, every door answers `400` with "This deployment keeps no backups: it has no bucket configured." |
| `WEAVE_BACKUP_KEY_ID` | the bucket access key id |
| `WEAVE_BACKUP_SECRET` | the bucket secret key |
| `WEAVE_BACKUP_ENDPOINT` | the S3 endpoint, for R2 `https://<account-id>.r2.cloudflarestorage.com` |
| `WEAVE_BACKUP_REGION` | the signing region; `auto` when an endpoint is set and this is not |
| `WEAVE_BACKUP_QUOTA_BYTES` | the per-account quota in bytes; 5 GiB when unset |

Archives land in the bucket as `<account id>/<archive>`.

## How you know it worked
`curl -s -H "Authorization: Bearer $WEAVE_BACKUP_TOKEN" https://weave.grunion.ai/api/backups` lists the archive the last run sent, and `weave restore --from weave://weave.grunion.ai/<account> --data /tmp/check` unpacks it with every sha256 check passed.