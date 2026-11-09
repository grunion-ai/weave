import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';

test('compact documentation banners reproduce the canonical full mark without changing the marketing kit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-doc-banners-'));
  try {
    execFileSync(process.execPath, [join(ROOT, 'brand/kit/build-kit.mjs'), '--documentation-banners', '--out', dir]);
    const names = ['banner-blue.svg', 'banner-light.svg', 'banner-topo.svg'];
    assert.deepEqual(readdirSync(dir).sort(), names);
    for (const name of names) {
      const svg = readFileSync(join(dir, name), 'utf8');
      assert.equal(svg, readFileSync(join(ROOT, 'src/handbook/banners', name), 'utf8'));
      assert.match(svg, /viewBox="0 0 1584 396"/);
      assert.match(svg, /<mask id="m\d+A"/);
      assert.match(svg, /DATA · AGENTS/);
      assert.match(svg, /SYSTEMS/);
      assert.match(svg, /x="300" y="48" width="984" height="300"/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
