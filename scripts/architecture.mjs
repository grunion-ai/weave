#!/usr/bin/env node
/* Re-pin and re-render the architecture map (docs/architecture/).

     node scripts/architecture.mjs [revision]

   Sets meta.repository.revision in weave.architecture.json to <revision>
   (default HEAD, which should be a landed commit so the source links resolve
   on GitHub), then runs archify's `deliver`, which verifies every cited
   file and line at that commit and writes weave.architecture.html. Run it in
   the same change as a release bump, and whenever test/architecture-map
   fails. archify is a dev tool, never a weave dependency: it is found at
   $ARCHIFY or ~/.claude/skills/archify/bin/archify.mjs (github.com/tt-a1i/archify,
   MIT). */
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

/* archify compares `git remote get-url origin` with meta.repository.url and
   does not strip the user name this repo's origin carries
   (https://grunion-ai@github.com/...). An insteadOf rewrite, for this one
   process only, hands it the bare URL without touching the repo config. */
const origin = git('remote', 'get-url', 'origin');
const bare = origin.replace(/^https:\/\/[^@/]+@/, 'https://');
const env = { ...process.env };
if (bare !== origin) {
  const prefix = origin.slice(0, origin.indexOf('@') + 1);
  Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.https://.insteadOf', GIT_CONFIG_VALUE_0: prefix });
}

execFileSync(process.execPath, [archify, 'deliver', 'architecture', specPath, htmlPath, '--quality', 'showcase', '--repo-root', root], { env, stdio: 'inherit' });
console.log(`architecture map pinned to ${revision.slice(0, 7)}`);
