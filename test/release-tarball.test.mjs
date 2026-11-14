import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';
import { unpackRelease } from '../src/supervisor.js';

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1 << 28 });
const SHA = git('rev-parse', 'HEAD').toString().trim();
const scratch = tempDir('weave-release-tarball-');
const RELEASE = join(scratch, 'release');
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const WILD = { '**/': '(?:.*/)?', '*': '[^/]*', '?': '[^/]' };
const glob = (pattern) => new RegExp('^' + pattern.replace(/[.+^$()|[\]{}\\]/g, '\\$&').replace(/\*\*\/|\*|\?/g, (m) => WILD[m]) + '$');
const PATTERNS = git('show', `${SHA}:.dockerignore`).toString().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^\/+|\/+$/g, ''));
const IGNORED = PATTERNS.map(glob);
const droppedAt = (path) => path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/')).find((prefix) => IGNORED.some((re) => re.test(prefix)));
const imageDrops = (path) => droppedAt(path) !== undefined;
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [relative(RELEASE, join(dir, e.name)).split('\\').join('/')]));

let unpacked;
const release = () => (unpacked ??= unpackRelease(git('archive', '--format=tar.gz', `--prefix=weave-${SHA}/`, SHA), RELEASE).then(() => filesUnder(RELEASE).sort()));

test('the .dockerignore matcher reads patterns the way Docker does', () => {
  assert.deepEqual(PATTERNS.filter((p) => /^!|[[\]\\]/.test(p)), [], 'every .dockerignore line is a plain glob this matcher reads: no negation, bracket or escape');
  assert.ok(imageDrops('test/release-tarball.test.mjs'));
  assert.ok(imageDrops('docs/screenshots/table.png'));
  assert.ok(imageDrops('src/scratch/workspace.db'));
  assert.ok(imageDrops('.github/workflows/release.yml'));
  assert.ok(!imageDrops('docs/development.json'));
  assert.ok(!imageDrops('src/supervisor.js'));
  assert.ok(!imageDrops('public/brand/favicon.ico'));
  assert.ok(!imageDrops('tests.md'));
});

test('the tarball the supervisor unpacks for this commit holds the image runtime set and nothing else', { timeout: 120_000 }, async () => {
  const files = await release();
  const tracked = git('ls-tree', '-r', '-z', '--name-only', SHA).toString().split('\0').filter(Boolean);
  assert.deepEqual([...new Set(files.filter(imageDrops).map(droppedAt))].sort(), [], 'every path .dockerignore keeps out of the image is export-ignore in .gitattributes');
  assert.deepEqual(files, tracked.filter((f) => !imageDrops(f)).sort(), 'the tarball and the image install the same tracked files');
  for (const runtime of ['bin/weave.js', 'src/supervisor.js', 'public/index.html', 'package.json', 'server.json', 'docs/development.json']) assert.ok(files.includes(runtime), `the tarball carries ${runtime}`);
});

test('a server booted from the unpacked tarball answers health with the tarball version', { timeout: 120_000 }, async () => {
  await release();
  const version = JSON.parse(readFileSync(join(RELEASE, 'package.json'), 'utf8')).version;
  const env = { ...process.env, HOME: join(scratch, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
  for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'WEAVE_TRACKER_CANONICAL', 'WEAVE_TRACK', 'PORT']) delete env[k];
  mkdirSync(join(scratch, 'data'), { recursive: true });
  const child = spawn(process.execPath, [join(RELEASE, 'bin', 'weave.js'), 'serve', '--port', '0', '--host', '127.0.0.1', '--data', join(scratch, 'data', 'workspace.db')], {
    cwd: RELEASE, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  try {
    const up = await new Promise((resolve, reject) => {
      child.on('message', (m) => { if (m?.weave === 'listening') resolve(m); });
      exited.then(({ code, signal }) => reject(new Error(`serve from the tarball exited (${signal ?? `code ${code}`}) before listening:\n${log}`)));
    });
    assert.equal(up.version, version);
    const r = await fetch(`http://127.0.0.1:${up.port}/api/health`);
    assert.equal(r.status, 200, log);
    const health = await r.json();
    assert.equal(health.ok, true);
    assert.equal(health.version, version);
    const mark = await fetch(`http://127.0.0.1:${up.port}/brand/weave-favicon.svg`);
    assert.equal(mark.status, 200, '/brand/ assets come from public/brand, not the repo-only brand/ the tarball leaves out');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.disconnect(); else child.kill('SIGTERM');
    }
    await exited;
  }
});
