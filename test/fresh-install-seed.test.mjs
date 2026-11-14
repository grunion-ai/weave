import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { scanSuites } from '../src/quality-mirror.js';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const scratch = tempDir('weave-fresh-install-');
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const ENV = { ...process.env, HOME: join(scratch, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'WEAVE_TRACKER_CANONICAL', 'PORT']) delete ENV[k];

let dirs = 0;
const freshDir = () => {
  const dir = join(scratch, `data-${++dirs}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const MANIFEST_PROBE = join(scratch, 'manifest-probe.mjs');
writeFileSync(MANIFEST_PROBE, [
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const read = fs.readFileSync;',
  "fs.readFileSync = function (path, ...rest) { if (String(path).endsWith('development.json')) process.stderr.write('PROBE read the tracker manifest\\n'); return read.call(this, path, ...rest); };",
  'syncBuiltinESMExports();',
].join('\n'));
const probed = (log) => /PROBE read the tracker manifest/.test(log);

function serve(dataPath, env = ENV) {
  const started = performance.now();
  const child = spawn(process.execPath, ['--import', pathToFileURL(MANIFEST_PROBE).href, BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', dataPath], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const listening = new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m?.weave === 'listening') resolve({ ...m, ms: performance.now() - started }); });
    exited.then(({ code, signal }) => reject(new Error(`serve exited (${signal ?? `code ${code}`}) before listening:\n${log}`)));
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.disconnect(); else child.kill('SIGTERM');
    }
    return exited;
  };
  return { listening, stop, log: () => log };
}

function openDocs(path) {
  const w = new Weave({ path });
  return { w, close: () => w.store.close?.() };
}

const qualityOf = (w) => ({
  space: w.listSpaces().some((s) => s.name === 'Quality'),
  suite: !!w.findTable('Quality/Suite'),
  kase: !!w.findTable('Quality/Case'),
});

test('a first serve on an empty data directory seeds no Quality rows, starts no tracker copy and listens within 2 s (Issue #1595)', { timeout: 120_000 }, async () => {
  const dir = freshDir();
  const s = serve(join(dir, 'workspace.db'));
  let up;
  try {
    up = await s.listening;
    const health = await (await fetch(`http://127.0.0.1:${up.port}/api/health`)).json();
    assert.equal(health.ok, true);
  } finally {
    assert.equal((await s.stop()).code, 0, s.log());
  }
  assert.match(s.log(), /Created docs workspace at /);
  assert.equal(probed(s.log()), false, `a fresh install read docs/development.json:\n${s.log()}`);
  assert.doesNotMatch(s.log(), /Development sync/);
  const { w, close } = openDocs(join(dir, 'weave.db'));
  try {
    assert.equal(w.state.meta.name, 'weave');
    assert.deepEqual(qualityOf(w), { space: false, suite: false, kase: false }, 'a fresh install carries no mirror of weave\'s own test suite');
    assert.equal(w.state.meta.developmentSync, undefined, 'nor a copy of weave\'s own tracker');
    assert.equal(w.listEntities(w.getTable('Development/Release').id).length, 0, 'no release row arrived from the manifest');
    assert.ok(w.findTable('Development/Issue'), 'the Issue table stays, so a bug report on this instance still files');
    assert.ok(w.findTable('Handbook/Guide'), 'the product handbook still ships');
  } finally { close(); }
  assert.ok(up.ms < 2000, `the first serve listened after ${Math.round(up.ms)} ms:\n${s.log()}`);
});

test('weave quality sync still builds the mirror on a docs workspace that has none, and quality check reads it clean (Issue #1595)', { timeout: 120_000 }, () => {
  const path = join(freshDir(), 'weave.db');
  const seeded = seedWeaver(new Weave({ path }));
  assert.deepEqual(qualityOf(seeded), { space: false, suite: false, kase: false }, 'the seed holds no mirror');
  seeded.store.close?.();
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args, '--data', path], { cwd: ROOT, env: ENV, encoding: 'utf8' });
  const scanned = scanSuites(ROOT);
  const everything = { suites: scanned.length, createdSuites: scanned.length, createdCases: scanned.reduce((n, s) => n + s.cases.length, 0) };

  const before = cli('quality', 'check');
  assert.equal(before.status, 1, `a workspace with no mirror is drift:\n${before.stderr}`);
  const planned = JSON.parse(before.stdout);
  assert.deepEqual({ suites: planned.suites, createdSuites: planned.createdSuites, createdCases: planned.createdCases }, everything);
  {
    const { w, close } = openDocs(path);
    try { assert.deepEqual(qualityOf(w), { space: false, suite: false, kase: false }, 'check writes nothing'); } finally { close(); }
  }

  const sync = cli('quality', 'sync');
  assert.equal(sync.status, 0, sync.stderr);
  const built = JSON.parse(sync.stdout);
  assert.deepEqual({ suites: built.suites, createdSuites: built.createdSuites, createdCases: built.createdCases }, everything);

  const after = cli('quality', 'check');
  assert.equal(after.status, 0, `no drift after the sync:\n${after.stdout}`);

  const { w, close } = openDocs(path);
  try {
    assert.deepEqual(qualityOf(w), { space: true, suite: true, kase: true });
    assert.equal(w.listEntities(w.getTable('Quality/Suite').id).length, scanned.length, 'one Suite row per test file');
    assert.equal(w.listEntities(w.getTable('Quality/Case').id).length, everything.createdCases, 'one Case row per declared case');
    const engine = w.query('Suite', { where: [['Name', '=', 'Engine']] }).items[0];
    assert.ok(engine.fields['Case Count'] >= 17, 'the Case Count rollup reads the built mirror');
  } finally { close(); }
});

function trackerCopy(dir) {
  const docs = seedWeaver(new Weave({ path: join(dir, 'weave.db') }));
  docs.state.meta.developmentSync = 'an older build';
  docs.save();
  docs.store.close?.();
  return join(dir, 'workspace.db');
}

test('the canonical tracker boots without reading the tracker manifest (Issue #1595)', { timeout: 120_000 }, async () => {
  const s = serve(trackerCopy(freshDir()), { ...ENV, WEAVE_TRACKER_CANONICAL: '1' });
  try { await s.listening; } finally { assert.equal((await s.stop()).code, 0, s.log()); }
  assert.match(s.log(), /Development sync skipped: this server is the canonical tracker \(WEAVE_TRACKER_CANONICAL=1\)/);
  assert.equal(probed(s.log()), false, `docs/development.json was read on the canonical tracker:\n${s.log()}`);
});

test('a read copy of the tracker still reads the manifest and syncs from it (Issue #1595)', { timeout: 120_000 }, async () => {
  const s = serve(trackerCopy(freshDir()));
  try { await s.listening; } finally { assert.equal((await s.stop()).code, 0, s.log()); }
  assert.ok(probed(s.log()), `the read copy never read docs/development.json:\n${s.log()}`);
  assert.match(s.log(), /Development sync v\d+\.\d+\.\d+: \d+ created/);
});
