import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SELF = 'test/node-only.test.mjs';
const BENDS = /store-cf|src\/worker\.js|workerd|WeaveWorkspace|CFStore|globalThis\.process/;

const sources = (dir) => readdirSync(join(ROOT, dir), { recursive: true })
  .map((f) => join(dir, f))
  .filter((f) => /\.(m?js|ya?ml|json)$/.test(f) && !f.split('/').includes('vendor') && f !== SELF);

test('the Cloudflare Workers adapter is gone (Issue #231)', () => {
  for (const gone of ['src/worker.js', 'src/store-cf.js', 'wrangler.toml.example', 'test/worker.test.mjs', 'test/store-cf.test.mjs']) {
    assert.ok(!existsSync(join(ROOT, gone)), `${gone} still ships`);
  }
});

test('no live code bends to the workerd runtime (Issue #231)', () => {
  const bent = ['src', 'bin', 'scripts', 'test', 'security'].flatMap(sources)
    .filter((f) => BENDS.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(bent, []);
});
