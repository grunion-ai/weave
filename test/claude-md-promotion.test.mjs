import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const claude = read('CLAUDE.md');
const dev = read('DEVELOPMENT.md');
const promotion = dev.slice(dev.indexOf('\n### Production promotion\n'), dev.indexOf('\n## ', dev.indexOf('\n### Production promotion\n')));
const releasing = dev.slice(dev.indexOf('\n## Releasing\n'), dev.indexOf('\n## ', dev.indexOf('\n## Releasing\n') + 1));

test('DEVELOPMENT.md owns the hosted update rule: production follows the branch promote.yml moves', () => {
  assert.ok(promotion.length > 100, 'DEVELOPMENT.md has a Production promotion section');
  assert.match(promotion, /Production follows the `production` branch/);
  assert.match(promotion, /\.github\/workflows\/promote\.yml/);
  assert.match(promotion, /Never hand-deploy Railway/);
  assert.match(promotion, /Node, `Dockerfile` or `src\/supervisor\.js`/);
});

test('releases leave production alone, in the section that owns releases', () => {
  assert.match(releasing, /never move production/);
});

test('CLAUDE.md routes hosted updates to Production promotion and restates none of it', () => {
  assert.match(claude, /DEVELOPMENT\.md#production-promotion/);
  assert.doesNotMatch(claude, /promote\.yml/, 'the workflow is named where the rule lives');
  for (const [name, doc] of [['CLAUDE.md', claude], ['AGENTS.md', read('AGENTS.md')], ['DEVELOPMENT.md', dev]]) {
    assert.doesNotMatch(doc, /updates itself from release tags|Cut a release instead|installs each new release\s+tag|production takes an approved `release` workflow run/, `${name} says release tags move production`);
  }
});
