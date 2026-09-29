#!/usr/bin/env node
/* The suite runner. `npm test`, the Gerrit gate and the GitHub matrix all
   come through here.

   Sixty-eight of the 192 suites drive a real Chromium. Under the full run
   they share a machine with each other and with whatever else is on it, and
   a wait for a menu to paint can lose to a thirty-second budget: a different
   browser case has been failing on roughly every other full run while the
   same file alone is green eight times out of eight (Issues #44, #199, #216,
   #239). Each of those cost a Verified −1 on a change that was fine, and a
   re-gate to prove it.

   So: run the suite, and if it fails, run the files that failed again — only
   those — and let the second answer stand. A test that is actually broken
   fails both times, because a real regression is not a coin toss; the retry
   can only rescue a failure that was not reproducible, which is the whole
   population it is meant for. Nothing green pays for this: the retry does
   not exist on a passing run.

   The flake does not disappear quietly. Every retried file is named on
   stdout under RETRIED, which is inside the tail weave-review.sh quotes into
   its Verified +1, so a suite that keeps needing the second chance says so
   in the review and can be fixed rather than absorbed.

   The retry is not the whole answer, and on 2026-09-28 it stopped being
   enough (Issues #454, #466): the same tree voted red five times and then
   green. The suite had grown to 130 browser files, and node's default of
   cores minus one files at once put nine of them up together, each a Node
   process with a server in it plus a Chromium of four or five processes.
   On a ten-core machine with nothing else running, the suite alone drove
   the load average to 27, and the cases that read a paint or a timer lost
   to their own siblings. So the suite runs in two lanes: everything that
   does not drive a browser at node's default, then the browser suites at
   half the cores. The retry stays for what is left.

   Usage: node scripts/test.mjs [file ...] [node --test flags ...]
   With no files named it runs the whole suite; `npm test -- --only` and the
   like reach node --test as written. */

import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = pathToFileURL(join(ROOT, 'scripts/failed-files.mjs')).href;

/* One. A file that needs three goes is not flaky, it is broken. */
export const RETRIES = 1;

/* The same set `node --test 'test/**\/*.test.mjs'` walked, in a stable order. */
export function testFiles(root = ROOT) {
  return readdirSync(join(root, 'test'), { recursive: true })
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => join('test', f).split('\\').join('/'))
    .sort();
}

/* A browser suite is one that drives Chromium: a -browser file, or one that
   loads the shared harness or playwright under another name. */
const BROWSER = /lib\/browser\.mjs|import\(['"]playwright/;
export function lanes(files, root = ROOT) {
  const browser = [], unit = [];
  for (const f of files) {
    let drives = /-browser\.test\.mjs$/.test(f);
    if (!drives) { try { drives = BROWSER.test(readFileSync(resolve(root, f), 'utf8')); } catch { /* not on disk */ } }
    (drives ? browser : unit).push(f);
  }
  return { unit, browser };
}

/* Half the cores: a browser suite keeps about two of them busy (its Node
   process and server, the renderer, the GPU process), so half the cores in
   files is the machine full and no more. */
export const browserConcurrency = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

/* node picks spec on a terminal and tap otherwise; asking for the collector
   would silently take that choice away, so it is made here and passed on.
   `cap` is the lane's --test-concurrency; a caller that names its own keeps it. */
export function argsFor(files, failedPath, extraArgs = [], tty = process.stdout.isTTY, cap = 0) {
  const capped = cap && !extraArgs.some((a) => a.startsWith('--test-concurrency'));
  return [
    '--test',
    `--test-reporter=${tty ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER}`, `--test-reporter-destination=${failedPath}`,
    ...(capped ? [`--test-concurrency=${cap}`] : []),
    ...extraArgs,
    ...files,
  ];
}

export function readFailed(failedPath) {
  if (!existsSync(failedPath)) return [];
  return readFileSync(failedPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
}

/* node:test marks the processes it runs test files in, and a `node --test`
   started inside one of them prints "run() is being called recursively" and
   then runs nothing at all — exit 0, no tests, a gate voting +1 on an empty
   run. The runner's own suite calls run(), so the mark is dropped here. */
export const childEnv = ({ NODE_TEST_CONTEXT, ...rest } = process.env) => rest;

/* Both lanes always run, so one gate names every red; the verdict is red if
   either is. */
export function run(files, extraArgs = [], opts = {}) {
  const { unit, browser } = lanes(files);
  let code = 0;
  if (unit.length) code = runLane(unit, extraArgs, 0, opts) || code;
  if (browser.length) code = runLane(browser, extraArgs, browserConcurrency(), opts) || code;
  return code;
}

function runLane(files, extraArgs, cap, { retries = RETRIES, out = console.log, env = childEnv() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-test-'));
  try {
    let attempt = files;
    for (let i = 0; ; i++) {
      const failedPath = join(dir, `failed-${i}`);
      const status = spawnSync(process.execPath, argsFor(attempt, failedPath, extraArgs, undefined, cap),
        { cwd: ROOT, stdio: 'inherit', env }).status;
      if (status === 0) {
        if (i) out(`# RETRIED and green: ${attempt.length} file(s) failed the first run and passed the second — ${attempt.join(' ')}`);
        return 0;
      }
      const failed = readFailed(failedPath);
      // No named file means the runner itself died — nothing to narrow to.
      if (i >= retries || !failed.length) {
        if (i) out(`# RETRIED and still red: ${failed.join(' ') || 'the run failed without naming a file'}`);
        return status || 1;
      }
      out(`# RETRYING ${failed.length} file(s) that failed: ${failed.join(' ')}`);
      attempt = failed;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* Only when run as the command: test/test-runner.test.mjs imports run(), and
   a bare import that spawned the suite would recurse. A bare `node --test`
   also discovers this file (it matches **\/test.mjs) and runs it as a test,
   with this file as argv[1]; NODE_TEST_CONTEXT marks that process, and it
   must not start a second suite beside the first (Issue #435). */
if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const named = argv.filter((a) => !a.startsWith('-'));
  const flags = argv.filter((a) => a.startsWith('-'));
  process.exit(run(named.length ? named : testFiles(), flags));
}
