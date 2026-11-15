import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { packTar } from '../src/backup.js';
import { startSupervisor, REPO_GIT } from '../src/supervisor.js';
import { tempDir } from './lib/temp.mjs';

const SHA = 'e'.repeat(40);
const REFS_URL = `${REPO_GIT}/info/refs?service=git-upload-pack`;
const ENV = { ...process.env, WEAVE_UPDATE_CHECK: 'off', WEAVE_TRACK: 'main' };
delete ENV.WEAVE_AUTO_UPDATE;
delete ENV.WEAVE_DEFER_MIGRATIONS;
delete ENV.WEAVE_DEPLOY_TOKEN;

const advertisement = (heads) => {
  const pkt = (s) => (s.length + 4).toString(16).padStart(4, '0') + s;
  const lines = Object.entries(heads).map(([branch, sha], i) => pkt(`${sha} refs/heads/${branch}${i === 0 ? '\0multi_ack\n' : '\n'}`));
  return [pkt('# service=git-upload-pack\n'), '0000', ...lines, '0000'].join('');
};

const workerBin = (version, { onMigrate = '' } = {}) => `import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
const data = process.argv[process.argv.indexOf('--data') + 1];
const s = createServer((q, r) => {
  r.setHeader('content-type', 'application/json');
  r.end(JSON.stringify({ ok: true, name: 'weave', version: ${JSON.stringify(version)} }));
});
s.listen(0, '127.0.0.1', () => process.send({ weave: 'listening', port: s.address().port, version: ${JSON.stringify(version)} }));
process.on('message', (m) => {
  if (m?.weave !== 'migrate') return;
  ${onMigrate || "process.send({ weave: 'migrated' });"}
});
`;

const manifest = (version) => JSON.stringify({ name: 'weave', version, type: 'module' });

function imageDir(root, version, bin) {
  const dir = join(root, 'image');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), manifest(version));
  writeFileSync(join(dir, 'bin', 'weave.js'), bin);
  return dir;
}

function tarball(root, version, bin) {
  const top = `grunion-ai-weave-${SHA.slice(0, 7)}/`;
  const file = join(root, 'release.tar');
  packTar(file, [
    { name: `${top}package.json`, data: Buffer.from(manifest(version)) },
    { name: `${top}bin/weave.js`, data: Buffer.from(bin) },
  ]);
  return gzipSync(readFileSync(file));
}

function workspace(root) {
  const dataPath = join(root, 'weave.db');
  const db = new DatabaseSync(dataPath);
  db.exec('CREATE TABLE seed (x)');
  db.close();
  return dataPath;
}

const waitFor = async (what, ms = 20_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await what()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting');
};

test('a worker that wrote its migration and then died is reported as dead once the alert is raised', async () => {
  const root = tempDir('weave-supervise-died-');
  const dataPath = workspace(root);
  const dying = workerBin('1.0.1', {
    onMigrate: "const db = new DatabaseSync(data); db.exec('CREATE TABLE IF NOT EXISTS fake_migration (x)'); db.close(); process.kill(process.pid, 'SIGKILL');",
  });
  const release = tarball(root, '1.0.1', dying);
  const fetch = async (url) => {
    url = String(url);
    if (url === REFS_URL) return new Response(advertisement({ main: SHA }));
    if (url.endsWith(`/tar.gz/${SHA}`)) return new Response(release);
    return new Response('not found', { status: 404 });
  };
  const events = [];
  const died = [];
  const sup = await startSupervisor({
    port: 0, host: '127.0.0.1', dataPath, env: ENV, fetch, imageDir: imageDir(root, '1.0.0', workerBin('1.0.0')),
    interval: 0, healthTimeoutMs: 1500, watchMs: 20_000, watchPollMs: 60_000,
    log: { log() {}, warn() {}, error() {} },
    onEvent: (e) => events.push(e),
    onWorkerDied: () => died.push(Date.now()),
  });
  try {
    assert.equal((await sup.check()).action, 'swapped');
    await waitFor(() => events.some((e) => e.type === 'watch-alert'));
    await waitFor(() => died.length > 0);
    assert.equal(died.length, 1);
    assert.equal(sup.status().watch.migrated, true);
    assert.ok(!events.some((e) => e.type === 'rolled-back'), 'a migrated release is never rolled back');
  } finally {
    await sup.close();
  }
});

test('a scheduled check that fails is logged as a warning and the supervisor keeps serving', async () => {
  const root = tempDir('weave-supervise-warn-');
  const dataPath = workspace(root);
  const warnings = [];
  const fetch = async () => new Response('down', { status: 500 });
  const sup = await startSupervisor({
    port: 0, host: '127.0.0.1', dataPath, env: ENV, fetch, imageDir: imageDir(root, '1.0.0', workerBin('1.0.0')),
    interval: 30, healthTimeoutMs: 5000, watchMs: 0,
    log: { log() {}, warn: (m) => warnings.push(m), error() {} },
  });
  try {
    await waitFor(() => warnings.some((m) => m.startsWith('weave supervise: check failed:')));
    assert.match(warnings.find((m) => m.startsWith('weave supervise: check failed:')), /ref advertisement answered HTTP 500/);
    assert.equal(sup.status().release, 'image');
  } finally {
    await sup.close();
  }
});
