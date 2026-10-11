import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../lib/source.mjs';

const DOCKERFILE = read('Dockerfile');
const IGNORE = read('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('the base image is pinned by digest, with the tag kept beside it for readers and bumpers', () => {
  const from = DOCKERFILE.match(/^FROM (\S+)$/m)?.[1];
  assert.ok(from, 'one FROM line');
  assert.match(from, /^node:\d+\.\d+\.\d+-slim@sha256:[0-9a-f]{64}$/, `FROM ${from} is not node:<tag>@sha256:<digest>`);
});

test('the application code is owned by root and read-only to the node user that runs it', () => {
  assert.match(DOCKERFILE, /^COPY \. \.$/m, 'the code is copied with no --chown, so root owns it');
  assert.doesNotMatch(DOCKERFILE, /--chown=node/m);
  assert.doesNotMatch(DOCKERFILE, /chown[^\n]*\/opt\/weave/m);
  assert.ok(DOCKERFILE.indexOf('USER node') > DOCKERFILE.indexOf('COPY . .'), 'the copy happens before the user switch');
});

test('.dockerignore patterns for workspace state and tooling are recursive, so a stray .db in a subdirectory never ships', () => {
  for (const pattern of ['**/*.db', '**/*.db-wal', '**/*.db-shm', '**/files/', '**/node_modules', '**/.DS_Store', '**/*.tmp', '**/*.orig', '**/update-check.json']) {
    assert.ok(IGNORE.includes(pattern), `.dockerignore lists ${pattern}`);
  }
  for (const rootOnly of ['*.db', '*.db-wal', '*.db-shm', 'files/', 'node_modules']) {
    assert.ok(!IGNORE.includes(rootOnly), `${rootOnly} matches the repository root only; the recursive form replaces it`);
  }
});
