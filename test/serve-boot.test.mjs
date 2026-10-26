import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'weave-v0.4.100.db');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const scratch = tempDir('weave-serve-boot-');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const HOME = join(scratch, 'home');
const ENV = { ...process.env, HOME, WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'WEAVE_TRACKER_CANONICAL', 'PORT']) delete ENV[k];

let copies = 0;
function oldWorkspace({ before588 = false } = {}) {
  const dir = join(scratch, `ws-${++copies}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'workspace.db');
  copyFileSync(FIXTURE, path);
  if (before588) {
    const db = new DatabaseSync(path);
    db.exec('ALTER TABLE doc_revisions DROP COLUMN restored_from');
    db.close();
  }
  return path;
}

function inspect(path, sql) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(sql).all().map((r) => ({ ...r })); } finally { db.close(); }
}
const revisionColumns = (path) => inspect(path, 'PRAGMA table_info(doc_revisions)').map((c) => c.name);

function serve(dataPath, env) {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', dataPath], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  const next = (type) => new Promise((resolve, reject) => {
    const on = (m) => { if (m?.weave === type) { child.off('message', on); resolve(m); } };
    child.on('message', on);
    exited.then(({ code, signal }) => reject(new Error(`serve exited (${signal ?? `code ${code}`}) before '${type}':\n${log}`)));
  });
  const listening = next('listening');
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.disconnect(); else child.kill('SIGTERM');
    }
    return exited;
  };
  return { child, listening, next, stop, log: () => log };
}

async function projectRow(base, name) {
  const r = await fetch(`${base}/api/tables/Project/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ where: [['Name', '=', name]] }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.total, 1, `one ${name} row: ${JSON.stringify(body).slice(0, 300)}`);
  return body.items[0].fields;
}

test('the v0.4.100 fixture is a real Weave workspace written before this release, small enough to commit', () => {
  assert.ok(statSync(FIXTURE).size < 2 * 1024 * 1024, 'under 2 MB');
  assert.deepEqual(inspect(FIXTURE, 'PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
  const names = inspect(FIXTURE, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
  for (const t of ['weave_meta', 'spaces', 'tables', 'entities', 'doc_revisions']) assert.ok(names.includes(t), `has ${t}`);
  assert.ok(inspect(FIXTURE, 'SELECT count(*) AS n FROM doc_revisions')[0].n > 0, 'seeded documents left revisions');
});

test('serve under WEAVE_DEFER_MIGRATIONS boots a pre-#588 workspace, answers health, reads seeded rows, and holds boot writes until migrate', { timeout: 120_000 }, async () => {
  const dataPath = oldWorkspace({ before588: true });
  const docs = join(dataPath, '..', 'weave.db');
  const revisions = inspect(dataPath, 'SELECT count(*) AS n FROM doc_revisions')[0].n;
  assert.ok(!revisionColumns(dataPath).includes('restored_from'), 'the copy has the doc_revisions shape releases before #588 wrote');
  const s = serve(dataPath, { ...ENV, WEAVE_DEFER_MIGRATIONS: '1', WEAVE_BACKUP_DEST: 's3://weave-serve-boot-test/never' });
  try {
    const up = await s.listening;
    assert.equal(up.version, VERSION, 'the worker reports its version over IPC the way the supervisor reads it');
    const base = `http://127.0.0.1:${up.port}`;
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.version, VERSION);
    assert.equal(health.workspace, 'personal-workspace');
    assert.equal(health.backup.dest, 's3://weave-serve-boot-test/never', 'the nightly backup hook is armed and named in health');
    assert.ok(Date.parse(health.backup.nextAt) > Date.now());
    assert.match(s.log(), /Nightly backup → s3:\/\/weave-serve-boot-test\/never at 04:00 UTC/);

    const apollo = await projectRow(base, 'Apollo Launch');
    assert.equal(apollo.Budget, 120000);
    assert.equal(apollo.Stage, 'Building');
    assert.match(apollo.Description, /The Q3 flagship release/);
    assert.deepEqual(apollo.Tasks.map((t) => t.name).sort(), ['Billing API migration', 'Design onboarding wizard', 'Fix signup race condition'].sort());

    assert.ok(revisionColumns(dataPath).includes('restored_from'), 'the store adds restored_from when it opens the file');
    assert.ok(!existsSync(docs), 'deferred: no boot write (the docs workspace) before the supervisor says migrate');

    s.child.send({ weave: 'migrate' });
    await s.next('migrated');
    assert.ok(existsSync(docs), 'migrate ran the boot writes: the docs workspace now exists beside the data');
    assert.equal((await projectRow(base, 'Hermes Docs')).Budget, 30000, 'still serving after migrate');
  } finally {
    const { code } = await s.stop();
    assert.equal(code, 0, `serve exits cleanly when the supervisor disconnects:\n${s.log()}`);
  }
  assert.deepEqual(inspect(dataPath, 'PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
  assert.equal(inspect(dataPath, 'SELECT count(*) AS n FROM doc_revisions')[0].n, revisions, 'every revision survived the migration');
  assert.deepEqual(inspect(dataPath, 'SELECT DISTINCT restored_from FROM doc_revisions'), [{ restored_from: null }]);
});

test('serve without deferral runs the boot writes before it listens', { timeout: 120_000 }, async () => {
  const dataPath = oldWorkspace();
  const s = serve(dataPath, ENV);
  try {
    const up = await s.listening;
    assert.ok(existsSync(join(dataPath, '..', 'weave.db')), 'docs workspace created at boot');
    assert.ok(revisionColumns(dataPath).includes('restored_from'));
    assert.equal((await projectRow(`http://127.0.0.1:${up.port}`, 'Apollo Launch')).Budget, 120000);
    assert.match(s.log(), /Weave running at http:\/\/127\.0\.0\.1:\d+ {2}\(workspace: personal-workspace/);
  } finally {
    assert.equal((await s.stop()).code, 0);
  }
});

function cli(dataPath, ...args) {
  const r = spawnSync(process.execPath, [BIN, '--data', dataPath, ...args], { cwd: ROOT, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

test('weave key set, list and delete write the keystore WEAVE_KEYSTORE names, sealed, and audit each change', () => {
  const dataPath = oldWorkspace();
  const keystore = ENV.WEAVE_KEYSTORE;
  rmSync(join(keystore, '..'), { recursive: true, force: true });
  assert.deepEqual(cli(dataPath, 'key', 'list').json(), []);

  const set = cli(dataPath, 'key', 'set', 'SERVE_BOOT_KEY', '--value', 'plain-value-1077');
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(set.json(), { name: 'SERVE_BOOT_KEY', set: true });
  assert.ok(existsSync(keystore), 'written where WEAVE_KEYSTORE points');
  assert.doesNotMatch(readFileSync(keystore, 'utf8'), /plain-value-1077/, 'the value is sealed at rest');
  assert.ok(!existsSync(join(HOME, '.weave')), 'nothing written under ~/.weave');

  const listed = cli(dataPath, 'key', 'list').json();
  assert.deepEqual(listed.map((k) => [k.name, k.set]), [['SERVE_BOOT_KEY', true]]);
  assert.equal(cli(dataPath, 'key').json().length, 1, 'bare key lists');
  assert.equal(cli(dataPath, 'key', 'reveal', 'SERVE_BOOT_KEY').out.trim(), 'plain-value-1077');

  assert.deepEqual(cli(dataPath, 'key', 'delete', 'SERVE_BOOT_KEY').json(), { name: 'SERVE_BOOT_KEY', deleted: true });
  assert.deepEqual(cli(dataPath, 'key', 'list').json(), []);
  const again = cli(dataPath, 'key', 'delete', 'SERVE_BOOT_KEY');
  assert.notEqual(again.code, 0, 'deleting a missing key fails');
  assert.match(again.err + again.out, /Key 'SERVE_BOOT_KEY' not found/);
  const bad = cli(dataPath, 'key', 'rotate');
  assert.notEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /Unknown key subcommand 'rotate'/);

  const actions = cli(dataPath, 'audit', '--limit', '10').json().map((a) => a.action);
  assert.ok(actions.includes('key-set') && actions.includes('key-deleted'), `audit names both changes: ${actions}`);
  assert.ok(!existsSync(join(HOME, '.weave')), 'still nothing under ~/.weave');
});
