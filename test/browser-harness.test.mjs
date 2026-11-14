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

test('a required engine that will not launch throws, naming the engine and keeping the cause (Issue #1451)', async () => {
  const { launchEngine } = await import('./lib/browser.mjs');
  const cause = new Error("Executable doesn't exist at /ms-playwright/webkit-2203/pw_run.sh");
  const thrown = await launchEngine({ webkit: { launch: () => Promise.reject(cause) } }, 'webkit').then(() => null, (e) => e);
  assert.ok(thrown, 'a launch failure is an error, not a null the caller can quietly drop');
  assert.match(thrown.message, /webkit/, 'the message names the engine that did not come up');
  assert.equal(thrown.cause, cause, 'the original launch error survives, so the log says why');
  const absent = await launchEngine({}, 'webkit').then(() => null, (e) => e);
  assert.match(absent?.message ?? '', /webkit/, 'an engine playwright does not carry fails the same way');
});

test('no browser suite registers fewer cases when an engine will not launch (Issue #1451)', () => {
  const silent = suites.flatMap(([f, src]) => [...src.matchAll(/const (\w+) = await engineOf\([^)]*\);\s*\n\s*if \(\1[\s&)]/g)]
    .map((m) => `${f}: ${m[0].split('\n').pop().trim()}`));
  assert.deepEqual(silent, [], 'engineOf throws when a required engine cannot launch; a suite that still guards on its result registers fewer cases instead of going red');
});

test('the harness itself skips cleanly without playwright and closes what it opened', () => {
  const src = readFileSync(join(DIR, 'lib/browser.mjs'), 'utf8');
  assert.match(src, /skip: 'playwright not installed'/, 'a missing playwright is a skip, not a failure');
  assert.match(src, /test\.after\([^]*?browser\?\.close\(\)[^]*?server\?\.close\(\)/, 'browser and server close after the suite');
  assert.match(src, /port: 0/, 'every suite gets a free port');
});
