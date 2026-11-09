import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const hosted = claude.split('\n').find((l) => l.includes('The hosted instance'));
const mainLanding = claude.split('\n').find((l) => l.startsWith('- Main lands through'));

test('CLAUDE.md names the promote workflow and the production branch for hosted updates', () => {
  assert.ok(hosted, 'hosted instance line present');
  assert.match(hosted, /promote\.yml/);
  assert.match(hosted, /`production` branch/);
  assert.match(hosted, /DEVELOPMENT\.md/);
});

test('CLAUDE.md does not say release tags or release runs move production', () => {
  assert.doesNotMatch(hosted, /updates itself from release tags/);
  assert.doesNotMatch(hosted, /Cut a release instead/);
  assert.doesNotMatch(mainLanding, /production takes an approved `release` workflow run/);
  assert.match(mainLanding, /promote\.yml/);
});

test('CLAUDE.md agrees with DEVELOPMENT.md that releases leave production alone', () => {
  assert.match(hosted, /releases? (?:publish|do not move)/i);
  assert.match(readFileSync(join(ROOT, 'DEVELOPMENT.md'), 'utf8'), /Production follows the `production` branch/);
});
