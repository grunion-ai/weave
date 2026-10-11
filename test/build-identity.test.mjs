import test from 'node:test';
import assert from 'node:assert/strict';
import { immutableBuildHead, describeBuild } from '../src/server.js';

const sha = 'a'.repeat(40);
test('immutable build identity prefers git and falls back to the Railway deployment SHA', () => {
  assert.equal(immutableBuildHead(sha, 'b'.repeat(40)), sha);
  assert.equal(immutableBuildHead(null, sha), sha);
  for (const bad of ['', 'main', 'abcdef0', 'a'.repeat(39), 'A'.repeat(40)]) assert.equal(immutableBuildHead(null, bad), null);
  assert.equal(describeBuild({ head: immutableBuildHead(null, sha) }).commit, sha);
  assert.equal(describeBuild({ head: sha }).sha, sha.slice(0, 7));
});

test('a runtime image without git reports its deployment commit through buildInfo', async () => {
  const { spawnSync } = await import('node:child_process');
  const source = new URL('../src/server.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { buildInfo } from ${JSON.stringify(source)}; console.log(JSON.stringify(buildInfo()));`], { encoding: 'utf8', env: { ...process.env, PATH: '', RAILWAY_GIT_COMMIT_SHA: sha } });
  assert.equal(child.status, 0, child.stderr);
  const build = JSON.parse(child.stdout);
  assert.equal(build.commit, sha);
  assert.equal(build.sha, sha.slice(0, 7));
  assert.equal(build.stale, undefined);
});
