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
const revision = git('rev-parse', '--verify', `${process.argv[2] ?? 'HEAD'}^{commit}`);

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
