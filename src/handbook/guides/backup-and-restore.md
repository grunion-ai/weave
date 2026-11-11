# Backup and restore

A weave instance is one directory: a `.db` per workspace (yours, plus the `weave.db` docs workspace), one `files/` directory of attachment blobs shared by all of them, `keystore.json`, and on a laptop `keystore.key` beside it. A Mac whose credentials live in the keychain has neither file: the values stay in the keychain (the key field guide, Key store). `weave backup` turns that directory into one archive; `weave restore` turns the archive back into a directory. Built in phase 3 of Feature #222 (Feature #209 asked for it; Issue #250 shaped the orphan report). No SQLite tooling, no tar, no cloud SDK: `node:sqlite`, `node:crypto` and `fetch`.

## What a backup holds

| Entry | How it is taken | Why |
| --- | --- | --- |
| `<workspace>.db`, one per workspace | `VACUUM INTO` a temp file from a throwaway connection | Safe while the server is writing: a read transaction in WAL mode, the WAL folded in, compacted, no `-wal`/`-shm` sidecars. A plain copy of a live database is a torn file. |
| `files/<id>` | Every blob in `files/` (a single-workspace backup takes only the blobs that workspace references) | Attachments live outside the `.db`; an export without them restores to dead links. |
| `keystore.json` | Copied as is, under the file store | Sealed by its own key, so it is useless alone. |
| `keys.json` | Under the keychain store: the key names, sorted | The values stay in the keychain, so the archive holds no secret material at all. |
| `manifest.json`, last | Written after everything else | Entry names and sizes, a sha256 per entry, entity counts per workspace, the weave version, and the orphan report. |

`keystore.key` **never** goes into the archive. It decrypts `keystore.json`, and the pair in one place is exactly the leak the keystore exists to survive. Instead the key material seals the archive (below), and the restore side needs it from your hand. Under the keychain store there is no `keystore.key`, so an encrypted or `weave://` backup needs `WEAVE_BACKUP_PASSPHRASE`, `WEAVE_KEYSTORE_PASSPHRASE` or `--passphrase-env`.

The archive is a plain POSIX tar: `tar -tf weave-backup-all-2026-09-12T04-00-00Z.tar` lists it, and any tar reads it. Names carry the scope (`all`, or one workspace) and the UTC instant, so they sort chronologically.

## The orphan report

A record can reference a blob that is not in `files/` any more — Issue #250 found fifty-six such references on one instance. The backup cannot copy bytes that are not there, so it **counts and lists** them in `manifest.json` and on stdout, and does not fail: a nightly job that went red over a source defect would teach everyone to ignore red. `weave restore` prints the same count so nobody is surprised by a dead link on the restored instance. The `orphan` count on the manifest is the number to watch; a rising one means bytes are going missing quietly.

## The three variables

| Variable | What it does |
| --- | --- |
| `WEAVE_BACKUP_DEST` | `s3://bucket/prefix`. On `weave backup` it is the default `--dest`. On `weave serve` it switches on the nightly. Unset, nothing leaves the machine. |
| `WEAVE_BACKUP_PASSPHRASE` | Seals the archive (AES-256-GCM under a scrypt-stretched key). Absent, `WEAVE_KEYSTORE_PASSPHRASE` is used — a hosted instance already has it in the environment — and absent that, the contents of `keystore.key`. With none of the three the archive is a plain tar; the command says so. `--passphrase-env NAME` names one variable and nothing else counts. |
| `WEAVE_BACKUP_ENDPOINT` | The S3-compatible endpoint for R2, B2 or MinIO (path-style, `endpoint/bucket/key`). Unset, the archive goes to AWS S3 in `WEAVE_BACKUP_REGION` (or `AWS_REGION`, default `us-east-1`). |

Credentials: `WEAVE_BACKUP_KEY_ID` and `WEAVE_BACKUP_SECRET`, or the standard `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Every request is signed with AWS Signature Version 4; R2, B2, MinIO and S3 all accept it. Signing uses the region: R2 takes `auto` (the default once an endpoint is set), B2 wants its real one (`us-west-004`, say) in `WEAVE_BACKUP_REGION`.

An archive larger than 8 MiB goes up as a multipart upload, one part at a time, so a backup holds one part in memory however large the archive is. `WEAVE_BACKUP_PART_BYTES` moves the part size; S3 requires 5 MiB for every part but the last, so a smaller setting is raised to that. A part that fails aborts the upload, which leaves no half object and no parts behind.

## Examples

Cloudflare R2:

```bash
export WEAVE_BACKUP_DEST=s3://weave-backups/nightly
export WEAVE_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export WEAVE_BACKUP_KEY_ID=<r2 access key id>
export WEAVE_BACKUP_SECRET=<r2 secret access key>
export WEAVE_BACKUP_PASSPHRASE='a long sentence you keep somewhere else'
node bin/weave.js backup --data /var/lib/weave
```

Backblaze B2 is the same with `WEAVE_BACKUP_ENDPOINT=https://s3.us-west-004.backblazeb2.com` and `WEAVE_BACKUP_REGION=us-west-004`. AWS S3 needs no endpoint: `WEAVE_BACKUP_DEST=s3://my-bucket/weave`, `AWS_REGION=eu-west-1`, the two `AWS_` credentials.

A local archive with nothing uploaded:

```bash
node bin/weave.js backup --data ~/.weave --out ~/Desktop
# Backup weave-backup-all-2026-09-12T04-00-00Z.tar.enc (58.1 MB, encrypted) → /Users/me/Desktop/…
#   weave: 2104 entities, 12.3 MB
#   uno: 388 entities, 7.0 MB
#   files: 258 attachment blobs copied
#   orphaned references (Issue #250): 56 — weave: c-json-editor.html, …
```

`--workspace uno` takes one workspace and its own blobs. `--out` may name a directory or the file itself. `--now` is the manual trigger of the run the nightly makes; it is the same run.

## The nightly switch

Set `WEAVE_BACKUP_DEST` (and the credentials) on the server and `weave serve` runs `backup` every day at 04:00 UTC — inside the process, on a timer re-armed after each run, not cron. Railway's cron services run in their own container and cannot mount the volume the data directory lives on, and a sidecar is one more thing to keep alive; a timer in the process that already holds the data needs neither. The archive is written to the temp directory, uploaded, and removed.

Each run writes one audit row: `backup-completed` with the archive name, its bytes and the orphan count, or `backup-failed` with the error. `weave audit` shows them. `/api/health` carries the last result:

```json
"backup": { "lastAt": "2026-09-12T04:00:00.000Z", "lastStatus": "completed", "nextAt": "2026-09-13T04:00:00.000Z", "dest": "s3://weave-backups/nightly" }
```

No credential is in it. A monitor that already reads health can alarm on `lastStatus: "failed"` or on a `lastAt` older than a day and a half.

## Retention

After a successful upload the job lists the prefix and deletes every `weave-backup-*` archive past the newest **thirty**. Anything else under the prefix is not its to delete. Thirty daily archives at the laptop's size is under two gigabytes; R2 stores that for free.

## Restore

```bash
node bin/weave.js restore weave-backup-all-2026-09-12T04-00-00Z.tar.enc --data /var/lib/weave-restored
node bin/weave.js restore s3://weave-backups/nightly/weave-backup-all-2026-09-12T04-00-00Z.tar.enc --data /var/lib/weave-restored
```

The source is a local path, an `s3://` key (fetched with the same signer and variables), or an `https://` URL. Restore decrypts with the same passphrase rule as backup and reads the archive as a stream, unpacking each entry into a scratch directory and hashing it on the way, so the memory a restore needs does not grow with the archive. It reads `manifest.json`, checks every entry's sha256 against it and refuses on the first mismatch, then moves the `.db` files, `files/`, `_hub.json` and `keystore.json` into `--data`. Those are the only kinds of entry backup writes, and the only ones restore lands: an archive that carries anything else (a `-wal` or `-shm` file SQLite would replay into the restored workspace, above all), carries one entry twice, or carries an entry its manifest does not list is refused before anything lands. A keychain backup has no `keystore.json`: restore reads `keys.json` and names every credential whose value this machine's key store does not hold, and `weave key set <name>` puts each one back.

It refuses a data directory a running process holds, with or without `--force`. Before it reads the archive, and again before it writes anything, it tries to take an exclusive lock on every `.db` in `--data`; a `weave serve`, `weave mcp` or other weave command with a workspace open makes that fail, and restore stops with "held open by a running process". Stop the server first. `--force` cannot override this, because the running process would keep writing to the file the restore replaced and lose every write made after it at its next restart. The `-wal` and `-shm` files a crashed server leaves behind do not count, since no process holds them. Without `--force`, restore also refuses to replace a workspace or `keystore.json` that is already there, or hub routing (`_hub.json`) and an attachment blob in `files/` whose bytes differ from the archive's; a file that matches byte for byte needs nothing. `--force` replaces them all and deletes each restored workspace's stale sidecars first.

Then start `weave serve --data /var/lib/weave-restored/<your workspace>.db`. The hub adopts every other `.db` beside it; nothing needs importing.

### keystore.key and passphrases

`keystore.json` lands; the key that opens it does not, by design. On a laptop, copy `keystore.key` back beside it (Kyle's is in the login Keychain; yours is wherever you put it — a password manager is the right place). On a hosted instance set `WEAVE_KEYSTORE_PASSPHRASE` to the value the original had. Without either, every credential reads as undecryptable and must be re-entered; everything else — workspaces, records, documents, attachments — is whole.

Under the keychain store nothing lands: the values are in the keychain of the Mac that took the backup. Restoring on the same Mac reports nothing missing; on another machine, set each named credential again, or run `weave key migrate --to file` on the original Mac first and back up the key file instead.

The backup passphrase and the keystore passphrase are separate things that default into each other. Keep whichever you set somewhere that is not the server and not the bucket.

### A restore rehearsal, quarterly

1. `weave restore <last night's archive> --data /tmp/rehearsal` on any machine.
2. `weave serve --port 4401 --data /tmp/rehearsal/<workspace>.db`.
3. Compare `/api/health` on `:4401` with the live instance: the `entities` count per workspace should match the manifest, and one attachment you know should download byte-for-byte.
4. Delete `/tmp/rehearsal`.

A backup you have not restored is a hope.

## The upgrade: Litestream

A nightly archive means a day of loss in the worst case. Litestream replicates the SQLite WAL to the same bucket continuously and restores to within seconds; it runs as one more process beside `weave serve` (on Railway, a second service on the same volume is not possible, so it goes into the same container as a supervisor of the serve process). Add it when a lost day would hurt; the nightly stays as the copy that does not depend on a replica being healthy. The laptop copy (`~/bin/weave-backup` into iCloud) keeps running regardless: two mechanisms, two failure modes.

## How you know it worked

`weave backup --out /tmp/check --data <your data dir>` prints one line per workspace with its entity count and ends with the orphan count; `tar -tf` on a plain archive (or the restored one) lists `manifest.json` last. Restore that archive into an empty directory, `weave serve` on it, and read `/api/health`: the `entities` figure matches the line the backup printed, and `curl -o - /api/files/<id>` on an attachment you know matches the original byte for byte. With the nightly on, tomorrow's `/api/health` carries `backup.lastStatus: "completed"` and the bucket holds one more archive than it did today.