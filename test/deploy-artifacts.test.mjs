/* Deploy artifacts (Feature #222, phase 1): one Dockerfile, one compose file,
   one manifest each for Railway and Fly, and the environment contract that
   every one of them and the Handbook agree on.

   The contract is the set of variables the "Environment reference" guide
   documents. The Dockerfile and compose.yaml must name exactly that set, so a
   variable added to one surface without the other is a red test, never a
   guide that lies about what the container reads.

   G3 (container boots, write survives restart) runs when a Docker daemon
   answers; otherwise it reports why and passes, because a missing daemon on
   a laptop is not a regression in the artifact. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, read } from './lib/source.mjs';
import { GUIDES } from '../src/handbook.js';

const DOCKERFILE = read('Dockerfile');
const COMPOSE = read('compose.yaml');
const RAILWAY = read('railway.json');
const FLY = read('fly.toml');
const IGNORE = read('.dockerignore');
const README = read('README.md');

/* The six variables the spec (Feature #222, Part 3) names as the contract. */
const SPEC_VARS = ['PORT', 'WEAVE_HOST', 'WEAVE_DATA', 'WEAVE_ORIGIN', 'WEAVE_KEYSTORE_PASSPHRASE', 'WEAVE_BACKUP_DEST'];
const varsIn = (text) => new Set([...text.matchAll(/\b(PORT|WEAVE_[A-Z_]+)\b/g)].map((m) => m[1]));

const GUIDE_TITLES = [
  'Self-host weave: choose your door',
  'Door A: an edge gate',
  'Door B: passkeys',
  'Deploy: Railway',
  'Deploy: Fly.io, Render, a VPS, Docker',
  'Backup and restore',
  'Environment reference',
];
const guide = (name) => GUIDES.find((g) => g.name === name);

test('the Dockerfile pins a node 22.x-slim tag at or above 22.16 and runs the serve verb as a non-root user', () => {
  const from = DOCKERFILE.match(/^FROM node:(\d+)\.(\d+)\.(\d+)-slim\s*$/m);
  assert.ok(from, 'FROM pins an exact node:<major>.<minor>.<patch>-slim tag');
  assert.equal(Number(from[1]), 22);
  assert.ok(Number(from[2]) >= 16, `node 22.${from[2]} is below 22.16, the floor package.json declares`);
  assert.match(DOCKERFILE, /^WORKDIR \/opt\/weave$/m);
  assert.match(DOCKERFILE, /^USER node$/m, 'the process runs as the image\'s unprivileged node user');
  assert.match(DOCKERFILE, /^VOLUME (\/data|\["\/data"\])$/m);
  assert.match(DOCKERFILE, /^EXPOSE 4400$/m);
  assert.match(DOCKERFILE, /^HEALTHCHECK [\s\S]*?\/api\/health/m, 'the health check probes /api/health');
  assert.match(DOCKERFILE, /^CMD \["node", ?"bin\/weave\.js", ?"serve"\]$/m, 'CMD is the serve verb, port/host/data from the environment');
  assert.doesNotMatch(DOCKERFILE, /^RUN .*(npm|build)/m, 'weave has no dependencies and no build step');
});

test('.dockerignore keeps workspace state, the browser install and the suite out of the image', () => {
  for (const pattern of ['*.db', '*.db-wal', '*.db-shm', 'files/', 'node_modules', '.jj', 'test/', 'docs/screenshots']) {
    assert.ok(IGNORE.split('\n').map((l) => l.trim()).includes(pattern), `.dockerignore lists ${pattern}`);
  }
});

test('compose.yaml mounts /data, probes /api/health, and is a compose file Docker accepts', () => {
  assert.match(COMPOSE, /:\/data\b/, 'a volume is mounted at /data');
  assert.match(COMPOSE, /\/api\/health/, 'the health check probes /api/health');
  assert.match(COMPOSE, /WEAVE_DATA: \/data\/workspace\.db/, 'the workspace lives on the volume');
  assert.match(COMPOSE, /"4400:4400"/, 'the port is published');
  if (!dockerReady()) return;
  execFileSync('docker', ['compose', '-f', join(ROOT, 'compose.yaml'), 'config', '-q'], { stdio: 'pipe' });
});

test('railway.json is valid config-as-code: /api/health, restart on failure, one replica, the serve verb', () => {
  const cfg = JSON.parse(RAILWAY);
  assert.equal(cfg.$schema, 'https://railway.com/railway.schema.json');
  assert.equal(cfg.build.builder, 'DOCKERFILE');
  assert.equal(cfg.deploy.healthcheckPath, '/api/health');
  assert.equal(cfg.deploy.restartPolicyType, 'ON_FAILURE');
  assert.equal(cfg.deploy.numReplicas, 1, 'a volume attaches to one service; replicas stay at 1');
  assert.equal(cfg.deploy.requiredMountPath, '/data');
  assert.match(cfg.deploy.startCommand, /node bin\/weave\.js serve/);
});

test('fly.toml runs one machine with a /data mount, the internal port from PORT, and a health check', () => {
  assert.match(FLY, /^\[\[?mounts\]?\]\n\s+source = "weave_data"\n\s+destination = "\/data"/m);
  assert.match(FLY, /^\[http_service\]\n(?:.*\n)*?\s+internal_port = 4400/m);
  assert.match(FLY, /min_machines_running = 1/);
  assert.match(FLY, /auto_stop_machines = "off"/, 'one always-on machine: the single writer never sleeps mid-WAL');
  assert.match(FLY, /^\[\[http_service\.checks\]\]\n(?:.*\n)*?\s+path = "\/api\/health"/m);
  const env = FLY.split('\n[env]\n')[1]?.split('\n[')[0] ?? '';
  assert.match(env, /PORT = "4400"/);
  assert.match(env, /WEAVE_HOST = "0\.0\.0\.0"/);
  assert.match(env, /WEAVE_DATA = "\/data\/workspace\.db"/);
});

test('the environment contract cannot drift: the reference guide, the Dockerfile and compose name the same variables', () => {
  const ref = guide('Environment reference');
  assert.ok(ref, 'there is an Environment reference guide');
  const documented = varsIn(ref.doc);
  for (const v of SPEC_VARS) assert.ok(documented.has(v), `the guide documents ${v}`);
  const artifacts = new Set([...varsIn(DOCKERFILE), ...varsIn(COMPOSE)]);
  assert.deepEqual([...documented].sort(), [...artifacts].sort(),
    'every variable the guide documents is in the Dockerfile/compose env block, and nothing undocumented is');
  for (const [file, text] of [['railway.json', RAILWAY], ['fly.toml', FLY]]) {
    for (const v of varsIn(text)) assert.ok(documented.has(v), `${file} names ${v}, which the guide does not document`);
  }
  // Nothing is reserved any more: phase 2 reads WEAVE_ORIGIN, phase 3 reads WEAVE_BACKUP_DEST.
  assert.doesNotMatch(ref.doc, /reserved for phase/i, 'no variable is still a promise');
  // Phase 3 landed: WEAVE_BACKUP_DEST is read by serve (the nightly) and by backup (the default --dest).
  assert.match(read('bin/weave.js'), /process\.env\.WEAVE_BACKUP_DEST/, 'serve reads WEAVE_BACKUP_DEST');
  assert.match(read('src/backup.js'), /env\.WEAVE_BACKUP_DEST/, 'backup reads WEAVE_BACKUP_DEST');
  assert.doesNotMatch(ref.doc, /`WEAVE_BACKUP_DEST`[^\n]*reserved/i, 'the reference no longer calls it reserved');
});

test('the Dockerfile and compose agree with the code on what each variable does', () => {
  const bin = read('bin/weave.js');
  assert.match(bin, /flags\.port \?\? process\.env\.PORT \?\? 4400/);
  assert.match(bin, /flags\.host \?\? process\.env\.WEAVE_HOST \?\? '127\.0\.0\.1'/);
  assert.match(bin, /flags\.data \?\? process\.env\.WEAVE_DATA/);
  assert.match(read('src/engine.js'), /keystoreEnv\?\.WEAVE_KEYSTORE_PASSPHRASE/);
  assert.match(read('src/engine.js'), /process\.env\.WEAVE_KEYSTORE \?\?/);
  // Attachments live in files/ beside the .db — so /data holds everything.
  assert.match(read('src/engine.js'), /join\(dirname\(this\.store\.path\), 'files', id\)/);
  // The keystore would otherwise land in $HOME, off the volume.
  assert.match(DOCKERFILE, /WEAVE_KEYSTORE=\/data\/keystore\.json/);
});

test('the self-hosting guides ship in the Handbook seed with their exact titles, each ending on a check', () => {
  for (const title of GUIDE_TITLES) {
    const g = guide(title);
    assert.ok(g, `the seed ships no '${title}' guide`);
    assert.equal(g.audience, 'Human');
    assert.ok(g.doc.startsWith(`# ${title}\n`), `${title} opens on its own heading`);
    assert.match(g.doc, /## How you know it worked/, `${title} ends with a check`);
  }
  const orders = GUIDE_TITLES.map((t) => guide(t).order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'the guides read in the order listed');
  // The remaining stub names the phase that fills it; door B is built (Feature #222 part 2).
  assert.doesNotMatch(guide('Door B: passkeys').doc, /Not built yet/);
  for (const s of ['weave account invite', 'revoke-session', 'remove-credential', 'WEAVE_ORIGIN', 'WEAVE_TRUST_PROXY', 'second device', 'wv_']) {
    assert.ok(guide('Door B: passkeys').doc.includes(s), `door B covers ${s}`);
  }
  assert.match(guide('Backup and restore').doc, /phase 3/i);
  assert.match(guide('Backup and restore').doc, /weave(\.js)? backup --data/, 'phase 3 landed: the guide documents the verb, not a promise');
});

test('the door and deploy guides carry the content the README used to hold, plus one block per gate and target', () => {
  const doors = guide('Self-host weave: choose your door').doc;
  for (const s of ['Edge gate', 'passkeys', 'OIDC', 'Tailscale']) assert.ok(doors.includes(s), `the matrix names ${s}`);
  const a = guide('Door A: an edge gate').doc;
  for (const s of ['Cloudflare Access', 'tailscale serve', 'basic_auth', 'oauth2-proxy', 'Authelia']) assert.ok(a.includes(s), `door A covers ${s}`);
  const rw = guide('Deploy: Railway').doc;
  for (const s of ['/data', 'WEAVE_DATA=/data/workspace.db', 'CNAME', '/api/health', 'numReplicas', 'RAILWAY_RUN_UID']) {
    assert.ok(rw.includes(s), `the Railway guide states ${s}`);
  }
  assert.match(rw, /cron[^\n]*cannot share the volume/i);
  const rest = guide('Deploy: Fly.io, Render, a VPS, Docker').doc;
  for (const s of ['## Fly.io', '## Render', '## A VPS', '## Docker', 'systemd', 'fly volumes create', 'compose up']) {
    assert.ok(rest.includes(s), `the deploy guide covers ${s}`);
  }
});

test('the README self-hosting section is an index into the guides and the container quick start', () => {
  const section = README.split('\n## Self-hosting\n')[1]?.split('\n## ')[0];
  assert.ok(section, 'README has a Self-hosting section');
  for (const title of GUIDE_TITLES) assert.ok(section.includes(title), `README points at '${title}'`);
  assert.match(section, /docker compose up/);
  assert.match(section, /Dockerfile/);
  assert.ok(section.length < 4000, 'the section is an index, not the guides pasted back in');
  assert.doesNotMatch(section, /systemd|Caddyfile/, 'the systemd and Caddy walkthroughs moved into the guides');
});

/* ---------- G3: the container boots and a write survives a restart ---------- */

function dockerReady() {
  try {
    execFileSync('docker', ['info'], { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}
const docker = (...args) => execFileSync('docker', args, { stdio: 'pipe', timeout: 600_000 }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealthy(base, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return j;
      }
      last = `HTTP ${r.status}`;
    } catch (err) {
      last = err.message;
    }
    await sleep(1000);
  }
  throw new Error(`/api/health never answered ok within ${seconds}s (last: ${last})`);
}
async function api(base, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

test('G3: docker build, run with the six variables, health ok, an entity survives a container restart', async (t) => {
  if (!dockerReady()) {
    t.diagnostic('G3 skipped: no Docker daemon answered `docker info` — start Docker (or colima) to run the container gate');
    return;
  }
  assert.ok(existsSync(join(ROOT, 'Dockerfile')));
  const tag = `weave-g3:${process.pid}`;
  const name = `weave-g3-${process.pid}`;
  const volume = `${name}-data`;
  try {
    docker('build', '-q', '-t', tag, ROOT);
    docker('volume', 'create', volume);
    docker('run', '-d', '--name', name, '-p', '127.0.0.1::4400', '-v', `${volume}:/data`,
      '-e', 'PORT=4400', '-e', 'WEAVE_HOST=0.0.0.0', '-e', 'WEAVE_DATA=/data/workspace.db',
      '-e', 'WEAVE_ORIGIN=http://127.0.0.1:4400', '-e', 'WEAVE_KEYSTORE_PASSPHRASE=g3-gate', '-e', 'WEAVE_BACKUP_DEST=',
      tag);
    // An ephemeral published port is reassigned on every (re)start: read it each time.
    const baseNow = () => `http://127.0.0.1:${docker('port', name, '4400').split('\n')[0].split(':').pop()}`;
    let base = baseNow();
    const healthy = async () => {
      base = baseNow();
      try { return await waitHealthy(base); } catch (err) {
        throw new Error(`${err.message}\n--- docker logs ---\n${execFileSync('docker', ['logs', '--tail', '30', name], { stdio: 'pipe' })}`);
      }
    };
    const first = await healthy();
    assert.equal(first.workspace, 'workspace', 'the workspace on the volume is the one the health reports');
    await api(base, 'POST', '/api/spaces', { name: 'G3' });
    const table = await api(base, 'POST', '/api/tables', { space: 'G3', name: 'Note' });
    await api(base, 'POST', `/api/tables/${table.id}/entities`, { name: 'survives a restart' });
    const before = (await api(base, 'POST', `/api/tables/${table.id}/query`, {})).total;
    assert.equal(before, 1);
    docker('restart', name);
    const second = await healthy();
    assert.ok(second.ok && first.ok, 'health ok twice');
    assert.notEqual(second.startedAt, first.startedAt, 'the second health is from the restarted process');
    const after = (await api(base, 'POST', `/api/tables/${table.id}/query`, {})).total;
    assert.equal(after, before, 'entity count unchanged across restart');
    // The process runs unprivileged and the volume is writable by it.
    assert.equal(docker('exec', name, 'id', '-u'), '1000');
    t.diagnostic(`G3 ran: ${tag} built, health ok twice, ${after} entity survived the restart`);
  } finally {
    for (const args of [['rm', '-f', name], ['volume', 'rm', '-f', volume], ['rmi', '-f', tag]]) {
      try { docker(...args); } catch { /* best effort */ }
    }
  }
});
