import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs'))
  .map((f) => [f, readFileSync(join(DIR, f), 'utf8')]);

test('every suite that needs a browser gets it from the shared harness', () => {
  const drivers = suites.filter(([f, src]) => f.endsWith('-browser.test.mjs') || /\bbrowser\.newPage\(|chromium\.launch\(/.test(src));
  assert.ok(drivers.length >= 20, `the browser suites are found (${drivers.length})`);
  for (const [f, src] of drivers) {
    assert.ok(src.includes("from './lib/browser.mjs'"), `${f} must import the harness`);
    assert.ok(!src.includes("import('playwright')"), `${f} must not import playwright itself; engineOf() launches an extra engine through the harness, so WEAVE_CPU_THROTTLE reaches it and the suite closes it (Issue #711)`);
    assert.ok(!/startServer\(/.test(src), `${f} must not start its own server; launch() does`);
  }
});

test('the harness itself skips cleanly without playwright and closes what it opened', () => {
  const src = readFileSync(join(DIR, 'lib/browser.mjs'), 'utf8');
  assert.match(src, /skip: 'playwright not installed'/, 'a missing playwright is a skip, not a failure');
  assert.match(src, /test\.after\([^]*?browser\?\.close\(\)[^]*?server\?\.close\(\)/, 'browser and server close after the suite');
  assert.match(src, /port: 0/, 'every suite gets a free port');
});
