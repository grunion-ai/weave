import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readLock } from '../../scripts/vendor-lock.mjs';

const FIRST_PATCHED = '3.4.13';
const bundle = readFileSync(join(ROOT, 'public/vendor/mermaid.min.js'), 'utf8');
const parts = (v) => v.split('.').map(Number);
const atLeast = (v, floor) => {
  const [a, b] = [parts(v), parts(floor)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test('the DOMPurify bundled in mermaid.min.js is past GHSA-55q2-fjhq-7xh7 and is the version the lock records', () => {
  const banner = bundle.match(/DOMPurify (\d+\.\d+\.\d+)/)?.[1];
  const property = bundle.match(/\.version="(\d+\.\d+\.\d+)"/)?.[1];
  assert.ok(banner, 'mermaid.min.js carries the DOMPurify license banner');
  assert.equal(property, banner, 'the banner and the DOMPurify.version property agree');
  assert.ok(atLeast(banner, FIRST_PATCHED), `DOMPurify ${banner} is inside the GHSA-55q2-fjhq-7xh7 range; ${FIRST_PATCHED} is the first patched release`);
  const by = Object.fromEntries(readLock().libraries.map((l) => [l.name, l]));
  assert.equal(by.dompurify.version, banner, 'security/vendor.lock.json records the bundled DOMPurify version');
  assert.ok(bundle.includes(`version:"${by.mermaid.version}"`), `mermaid.min.js is the ${by.mermaid.version} build the lock records`);
});

test('the bundle is the single-file IIFE the app loads with a script tag: a mermaid global, no module syntax', () => {
  assert.match(bundle, /globalThis\["mermaid"\] = /);
  assert.doesNotMatch(bundle.slice(-400), /^export /m);
  assert.ok(bundle.length > 2_000_000, 'the diagram chunks are inlined, not left as dynamic imports');
});
