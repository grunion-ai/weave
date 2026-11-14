import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { backup, restore, heldOpen, readTar } from '../src/backup.js';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const scratch = tempDir('weave-restore-live-');
const ENV = { ...process.env, HOME: join(scratch, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_TRACKER_CANONICAL: '1', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'PORT']) delete ENV[k];

let made = 0;
const fresh = (label) => {
  const dir = join(scratch, `${label}-${++made}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

function seeded() {
  const dir = fresh('data');
  const db = join(dir, 'alpha.db');
  const w = new Weave({ path: db });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const task = w.createEntity('Ops/Task', { name: 'Before the backup' });
  const blob = w.attachFile(task.id, { name: 'spec.txt', mime: 'text/plain', bytes: Buffer.from('the attachment as backed up\n') });
  w.store.close();
  return { dir, db, blob: blob.id };
}

const archiveOf = async (dir) => (await backup({ dataDir: dir, out: fresh('out'), env: {} })).path;

function has(db, name) {
  const w = new Weave({ path: db });
  try { return Boolean(w.findEntity('Ops/Task', name)); } finally { w.store.close(); }
}

function emptyDocsWorkspace(dir) {
  const docs = new Weave({ path: join(dir, 'weave.db') });
  docs.state.meta.name = 'weave';
  docs.save();
  docs.store.close();
}

async function serving(dataPath) {
  if (!existsSync(join(dirname(dataPath), 'weave.db'))) emptyDocsWorkspace(dirname(dataPath));
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', dataPath], {
    cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const { port } = await new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m?.weave === 'listening') resolve(m); });
    exited.then((code) => reject(new Error(`weave serve exited (${code}) before it listened:\n${log}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    write: (name) => fetch(`${base}/api/tables/Task/entities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
    stop: async (signal = null) => {
      if (child.exitCode === null && child.signalCode === null) {
        if (signal) child.kill(signal); else child.disconnect();
      }
      await exited;
    },
  };
}

test('restore refuses a data directory a running weave serve holds, with and without --force, so every write the server accepts stays in the file on disk (Issue #1662)', async () => {
  const { dir, db } = seeded();
  const archive = await archiveOf(dir);
  const server = await serving(db);
  const outcomes = [];
  let written;
  try {
    for (const force of [false, true]) outcomes.push(await restore({ source: archive, dataDir: dir, env: {}, force }).then(() => 'landed', (err) => err));
    written = await server.write('Written while the server ran');
  } finally {
    await server.stop();
  }
  assert.ok(written.ok, `the server took the write: ${written.status}`);
  assert.ok(has(db, 'Written while the server ran'), 'the write the server accepted is in the file on disk, not in a replaced file only the server could still see');
  for (const [i, outcome] of outcomes.entries()) {
    const how = i ? 'with --force' : 'without --force';
    assert.equal(outcome?.code, 'conflict', `restore ${how} refused: ${outcome?.message ?? outcome}`);
    assert.match(outcome.message, /(alpha|weave)\.db is held open/, how);
    assert.match(outcome.message, /Stop the server first/, how);
    assert.match(outcome.message, /--force does not override/, how);
  }
});

test('the -wal and -shm a killed server leaves behind are not a live holder: restore asks for --force, and --force lands the archive', async () => {
  const { dir, db } = seeded();
  const archive = await archiveOf(dir);
  const server = await serving(db);
  try {
    assert.ok((await server.write('Written after the backup')).ok);
  } finally {
    await server.stop('SIGKILL');
  }
  assert.ok(existsSync(`${db}-wal`) && existsSync(`${db}-shm`), 'the killed server never closed, so both sidecars stayed');
  assert.equal(heldOpen(db), false, 'no process holds the database');
  await assert.rejects(restore({ source: archive, dataDir: dir, env: {} }), (err) => err.code === 'conflict' && /alpha\.db exists/.test(err.message) && !/held open/.test(err.message));
  const r = await restore({ source: archive, dataDir: dir, env: {}, force: true });
  assert.ok(r.landed.includes('alpha.db'));
  assert.ok(!existsSync(`${db}-wal`), 'no stale -wal sits beside the restored file');
  assert.ok(has(db, 'Before the backup'), 'the archive landed');
  assert.ok(!has(db, 'Written after the backup'), 'the restored file is the archive, not the old file with its WAL replayed');
});

test('heldOpen reads the lock and not the files: an idle connection holds the database, its sidecars alone do not', async () => {
  const { dir, db } = seeded();
  const archive = await archiveOf(dir);
  assert.equal(heldOpen(db), false, 'a closed workspace is free');
  const w = new Weave({ path: db });
  try {
    assert.equal(heldOpen(db), true, 'an idle connection, the kind weave serve keeps open, holds the database');
    rmSync(`${db}-wal`);
    rmSync(`${db}-shm`);
    assert.equal(heldOpen(db), true, 'with its sidecars deleted the connection still holds the database');
    await assert.rejects(restore({ source: archive, dataDir: dir, env: {}, force: true }), (err) => err.code === 'conflict' && /held open/.test(err.message));
  } finally {
    w.store.close();
  }
  assert.equal(heldOpen(db), false, 'closed again, it is free');
  const missing = join(dir, 'missing.db');
  assert.equal(heldOpen(missing), false);
  assert.ok(!existsSync(missing), 'the probe creates no file');
  const foreign = join(dir, 'foreign.db');
  writeFileSync(foreign, 'not a database');
  assert.equal(heldOpen(foreign), false, 'a file that is not SQLite has no holder');
});

test('restore changes hub routing or a blob already there only with --force (Issue #1669)', async () => {
  const { dir, blob } = seeded();
  const routes = JSON.stringify({ 'old.db': 'alpha.db' });
  writeFileSync(join(dir, '_hub.json'), routes);
  const archive = await archiveOf(dir);
  const names = readTar(archive).map((e) => e.name);
  assert.ok(names.includes('_hub.json') && names.includes(`files/${blob}`), 'a full backup carries hub routing and the blob');
  const archived = { '_hub.json': routes, [`files/${blob}`]: 'the attachment as backed up\n' };
  const theirs = { '_hub.json': JSON.stringify({ 'old.db': 'beta.db' }), [`files/${blob}`]: 'another attachment under the same id\n' };
  for (const name of Object.keys(theirs)) {
    const target = fresh('target');
    mkdirSync(join(target, 'files'), { recursive: true });
    writeFileSync(join(target, name), theirs[name]);
    await assert.rejects(restore({ source: archive, dataDir: target, env: {} }), (err) => err.code === 'conflict' && err.message.includes(join(target, name)) && /--force/.test(err.message), name);
    assert.equal(readFileSync(join(target, name), 'utf8'), theirs[name], `${name} is untouched without --force`);
    assert.ok(!existsSync(join(target, 'alpha.db')), `nothing landed beside ${name}`);
    const r = await restore({ source: archive, dataDir: target, env: {}, force: true });
    assert.ok(r.landed.includes(name));
    assert.equal(readFileSync(join(target, name), 'utf8'), archived[name], `--force replaced ${name}`);
  }
});

test('hub routing and a blob already there byte for byte need no --force, so a restore into a directory no server holds still works', async () => {
  const { dir, blob } = seeded();
  writeFileSync(join(dir, '_hub.json'), JSON.stringify({ 'old.db': 'alpha.db' }));
  const archive = await archiveOf(dir);
  const target = fresh('same');
  mkdirSync(join(target, 'files'), { recursive: true });
  for (const name of ['_hub.json', `files/${blob}`]) writeFileSync(join(target, name), readFileSync(join(dir, name)));
  const r = await restore({ source: archive, dataDir: target, env: {} });
  assert.deepEqual([...r.landed].sort(), ['_hub.json', 'alpha.db', `files/${blob}`]);
  assert.ok(has(join(target, 'alpha.db'), 'Before the backup'));
  assert.ok(readFileSync(join(target, 'files', blob)).equals(readFileSync(join(dir, 'files', blob))));
});
