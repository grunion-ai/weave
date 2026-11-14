import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../../.github/workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const text = (f) => readFileSync(join(DIR, f), 'utf8');
const PINNED = /@sha256:[0-9a-f]{64}$/;

function images(source) {
  const found = [];
  let block = null;
  for (const [i, line] of source.split('\n').entries()) {
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    if (block !== null && indent <= block) block = null;
    const key = line.match(/^\s*(container|services):\s*(.*)$/);
    if (key) {
      if (key[1] === 'container' && key[2]) found.push({ line: i + 1, value: key[2] });
      else block = indent;
      continue;
    }
    const image = block !== null && line.match(/^\s*image:\s*(\S.*)$/);
    if (image) found.push({ line: i + 1, value: image[1] });
    const docker = line.match(/^\s*-?\s*uses:\s*docker:\/\/(\S+)/);
    if (docker) found.push({ line: i + 1, value: docker[1] });
  }
  return found;
}

function unpinned(value) {
  const literal = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const conditional = literal.match(/^\$\{\{\s*(.+?)\s*&&\s*'([^']+)'\s*\|\|\s*''\s*\}\}$/);
  const image = conditional ? conditional[2] : literal.includes('${{') ? null : literal;
  return !image || !PINNED.test(image);
}

const findings = (source, at = 'workflow') => images(source).filter(({ value }) => unpinned(value)).map(({ line, value }) => `${at}:${line} ${value}`);

test('every container and service image in every workflow is pinned by digest (Feature #368)', () => {
  assert.deepEqual(files.flatMap((f) => findings(text(f), f)), [],
    'a tag moves under the same name, so a shard pinned by tag can start from browsers nobody tested; name the image by tag and @sha256 digest');
});

test('the image lint sees the browser shards of the PR gate and the CI gate', () => {
  for (const f of ['pr.yml', 'test.yml']) {
    assert.ok(images(text(f)).length > 0, `${f} names its container image where the lint reads it`);
  }
});

test('the image lint reads every form a workflow names an image in, and refuses one it cannot verify', () => {
  const digest = `@sha256:${'a'.repeat(64)}`;
  const source = [
    'jobs:',
    '  inline:',
    '    container: node:24',
    '  pinned-inline:',
    `    container: "node:24${digest}"`,
    '  mapping:',
    '    container:',
    '      image: ghcr.io/example/tool:1.0',
    '      options: --user 1001',
    '  pinned-mapping:',
    '    container:',
    `      image: ghcr.io/example/tool:1.0${digest}`,
    '  conditional:',
    '    container:',
    `      image: \${{ matrix.lane == 'browser' && 'mcr.microsoft.com/playwright:v1.0.0-noble${digest}' || '' }}`,
    '  conditional-tag:',
    '    container:',
    "      image: ${{ matrix.lane == 'browser' && 'mcr.microsoft.com/playwright:v1.0.0-noble' || '' }}",
    '  dynamic:',
    '    container: ${{ matrix.image }}',
    '  with-services:',
    '    services:',
    '      db:',
    '        image: postgres:17',
    '      cache:',
    `        image: redis:8${digest}`,
    '  docker-steps:',
    '    steps:',
    '      - uses: docker://alpine:3.22',
    `      - uses: docker://alpine:3.22${digest}`,
    '  image:',
    '    runs-on: ubuntu-24.04',
  ].join('\n');
  assert.deepEqual(findings(source), [
    'workflow:3 node:24',
    'workflow:8 ghcr.io/example/tool:1.0',
    "workflow:18 ${{ matrix.lane == 'browser' && 'mcr.microsoft.com/playwright:v1.0.0-noble' || '' }}",
    'workflow:20 ${{ matrix.image }}',
    'workflow:24 postgres:17',
    'workflow:29 alpine:3.22',
  ]);
});
