import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tempDir } from './lib/temp.mjs';

function fixture() {
  const root = tempDir('weave-architecture-pin-');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'docs/architecture'), { recursive: true });
  copyFileSync(new URL('../scripts/architecture.mjs', import.meta.url), join(root, 'scripts/architecture.mjs'));
  const specPath = join(root, 'docs/architecture/weave.architecture.json');
  writeFileSync(specPath, JSON.stringify({ meta: { repository: { revision: 'unchanged' } } }));
  const archify = join(root, 'archify.mjs');
  writeFileSync(archify, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[5], 'rendered');");
  git('init', '-b', 'main');
  git('config', 'user.name', 'Architecture test');
  git('config', 'user.email', 'architecture@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/grunion-ai/weave.git');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  git('checkout', '-b', 'feature');
  git('commit', '--allow-empty', '-m', 'branch-only');
  const branch = git('rev-parse', 'HEAD');
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/architecture.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ARCHIFY: archify } });
  const revision = () => JSON.parse(readFileSync(specPath, 'utf8')).meta.repository.revision;
  return { git, base, branch, run, revision };
}

test('architecture defaults to the shared main ancestor on a feature branch (Issue #1507)', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.revision(), f.base);
});

test('architecture refuses an explicit branch-only pin before writing the map', () => {
  const f = fixture();
  const result = f.run(f.branch);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin\/main/);
  assert.equal(f.revision(), 'unchanged');
});

test('architecture accepts an explicit main ancestor and a detached main checkout', () => {
  const f = fixture();
  assert.equal(f.run(f.base).status, 0);
  assert.equal(f.revision(), f.base);
  f.git('checkout', '--detach', f.base);
  assert.equal(f.run().status, 0);
  assert.equal(f.revision(), f.base);
});

test('architecture fails before changing the map when main history is unavailable', () => {
  const f = fixture();
  f.git('update-ref', '-d', 'refs/remotes/origin/main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /origin\/main/);
  assert.equal(f.revision(), 'unchanged');
});


test('architecture keeps the shared ancestor when origin/main advances separately', () => {
  const f = fixture();
  f.git('checkout', 'main');
  f.git('commit', '--allow-empty', '-m', 'new-main');
  const newer = f.git('rev-parse', 'HEAD');
  f.git('update-ref', 'refs/remotes/origin/main', newer);
  f.git('checkout', 'feature');
  assert.equal(f.run().status, 0);
  assert.equal(f.revision(), f.base);
  assert.notEqual(f.run(newer).status, 0);
  assert.equal(f.revision(), f.base);
});
