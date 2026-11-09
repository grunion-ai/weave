#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(root, 'docs', 'architecture', 'weave.architecture.json');
const htmlPath = join(root, 'docs', 'architecture', 'weave.architecture.html');
const archify = process.env.ARCHIFY ?? join(homedir(), '.claude', 'skills', 'archify', 'bin', 'archify.mjs');
if (!existsSync(archify)) {
  console.error(`archify not found at ${archify}: install the harness archify skill or set ARCHIFY`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const fetchHint = 'run `git fetch origin main` and retry';
const resolve = (rev) => {
  try {
    return git('rev-parse', '--verify', '--quiet', `${rev}^{commit}`);
  } catch {
    return null;
  }
};
const isAncestor = (a, b) => {
  try {
    execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const head = resolve('HEAD') ?? fail('cannot resolve HEAD');
const main = resolve('origin/main') ?? fail(`origin/main is not available: ${fetchHint}`);
let revision;
if (process.argv[2]) {
  revision = resolve(process.argv[2]) ?? fail(`cannot resolve ${process.argv[2]} to a commit: ${fetchHint}`);
  if (!isAncestor(revision, head) || !isAncestor(revision, main)) {
    fail(`${revision} is not an ancestor of both HEAD and origin/main, so a squash merge could lose it: ${fetchHint} or choose a main commit`);
  }
} else {
  try {
    revision = git('merge-base', head, main);
  } catch {
    fail(`no merge-base between HEAD and origin/main: ${fetchHint}`);
  }
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
spec.meta.repository.revision = revision;
writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');

const origin = git('remote', 'get-url', 'origin');
const bare = origin.replace(/^https:\/\/[^@/]+@/, 'https://');
const env = { ...process.env };
if (bare !== origin) {
  const prefix = origin.slice(0, origin.indexOf('@') + 1);
  Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.https://.insteadOf', GIT_CONFIG_VALUE_0: prefix });
}

execFileSync(process.execPath, [archify, 'deliver', 'architecture', specPath, htmlPath, '--quality', 'showcase', '--repo-root', root], { env, stdio: 'inherit' });
console.log(`architecture map pinned to ${revision.slice(0, 7)}`);
