#!/usr/bin/env node

import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = pathToFileURL(join(ROOT, 'scripts/failed-files.mjs')).href;

export const RETRIES = 1;

export function testFiles(root = ROOT) {
  return readdirSync(join(root, 'test'), { recursive: true })
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => join('test', f).split('\\').join('/'))
    .sort();
}

const BROWSER = /^(?:import\s[^;]*?from\s*|(?:const|let)\s[^=;]*=\s*await\s+import\(\s*)['"](?:[^'"\n]*\/lib\/browser\.mjs|playwright)['"]/m;
export function lanes(files, root = ROOT) {
  const browser = [], unit = [];
  for (const f of files) {
    let drives = /-browser\.test\.mjs$/.test(f);
    if (!drives) { try { drives = BROWSER.test(readFileSync(resolve(root, f), 'utf8')); } catch {} }
    (drives ? browser : unit).push(f);
  }
  return { unit, browser };
}

export const browserConcurrency = (cores = availableParallelism()) => Math.max(1, Math.floor(cores / 2));

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

export const childEnv = ({ NODE_TEST_CONTEXT, ...rest } = process.env) => rest;

export function run(files, extraArgs = [], opts = {}) {
  if (!files.length) throw new Error('Empty test selection refused');
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

if (!process.env.NODE_TEST_CONTEXT && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2).filter((a) => a !== '--');
    const { request, fingerprint, NOT_ADMITTED } = await import('./test-manager.mjs');
    const control = argv.find((a) => ['--status', '--stop'].includes(a) || a.startsWith('--cancel='));
    if (control) {
      const type = control.slice(2).split('=')[0];
      const result = await request({ type, id: control.split('=')[1] }).catch((error) => {
        if (type === 'status' && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) return { type: 'status', running: false };
        throw error;
      });
      console.log(JSON.stringify(result, null, 2)); process.exit(result.code || 0);
    }
    const affected = argv.includes('--affected');
    const targeted = argv.includes('--targeted');
    const base = argv.find((a) => a.startsWith('--base='))?.slice(7) || 'HEAD';
    const timeoutArg = argv.find((a) => a.startsWith('--timeout='));
    const timeout = timeoutArg ? Number(timeoutArg.slice(10)) : undefined;
    if (timeoutArg && (!Number.isFinite(timeout) || timeout < 100)) throw new Error('--timeout requires milliseconds >= 100');
    const args = argv.filter((a) => !['--affected', '--targeted', '--plan'].includes(a) && !/^--(?:base|timeout)=/.test(a));
    const valued = new Set(['--test-name-pattern', '--test-skip-pattern', '--test-concurrency', '--test-timeout']);
    for (let i = 0; i < args.length; i++) if (valued.has(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${args[i]} requires a value`);
      args.splice(i, 2, `${args[i]}=${args[i + 1]}`);
    }
    const named = args.filter((a) => !a.startsWith('-'));
    const flags = args.filter((a) => a.startsWith('-'));
    if (targeted && !named.length) throw new Error('--targeted requires a non-empty file selection');
    if (affected && named.length) throw new Error('Use --affected or explicit test files, not both');
    const selection = affected
      ? (await import('./test-selection.mjs')).affectedTests(ROOT, base)
      : { files: named.length ? [...new Set(named)] : testFiles(), mode: named.length ? 'targeted' : 'full', reasons: [named.length ? 'Explicit test selection.' : 'Full verification requested.'] };
    if (!selection.files.length) throw new Error('Empty test selection refused');
    for (const file of selection.files) if (!existsSync(resolve(ROOT, file))) throw new Error(`Test file does not exist: ${file}`);
    if (argv.includes('--plan')) { console.log(JSON.stringify(selection, null, 2)); process.exit(0); }
    if (process.env.WEAVE_TEST_JOB) process.exit(run(selection.files, flags));
    console.log(`# TEST SELECTION ${selection.mode}: ${selection.reasons.join(' ')}`);
    const result = await request({ type: 'run', root: ROOT, node: process.execPath, files: selection.files, flags, timeout,
      env: childEnv(), fingerprint: fingerprint(ROOT, selection.files) }, { start: true, onMessage(message) {
        if (message.stream) process[message.stream].write(Buffer.from(message.data, 'base64'));
        if (message.event) console.log(message.event);
      } });
    if (result.code === NOT_ADMITTED) console.log(`# TEST MANAGER NOT ADMITTED: ${result.error}`);
    else if (result.error) console.error(`# TEST MANAGER ${result.error}`);
    process.exit(result.code);
  } catch (error) { console.error(error.message); process.exit(1); }
}
