import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const README = read('README.md');
const CONFIG = read('docs/_config.yml');
const section = (title) => README.split(`\n## ${title}\n`)[1]?.split('\n## ')[0] ?? '';

test('the README head names the category beside the wordmark', () => {
  const head = README.split('\n## ')[0];
  assert.match(head, /Airtable alternative/i);
  assert.match(head, /\bMCP\b/);
});

test('the README does not deny the hosted instance it links to (Issue #1118)', () => {
  assert.doesNotMatch(README, /Not a hosted product/i);
  assert.doesNotMatch(README, /no cloud tier/i);
  assert.match(section('What weave is not'), /weave\.grunion\.ai/);
});

test('the README permissions line names share links as the narrower grant (Issue #1143)', () => {
  assert.doesNotMatch(README, /Nothing narrows access to one space, row or field/);
  assert.match(section('What weave is not'), /share link/i);
});

test('the README does not list forms as missing (Issue #1144)', () => {
  assert.doesNotMatch(README, /hosted forms/i);
  assert.match(section("What's inside"), /\| Forms \|/);
});

test('the README refuses an extension API, not the plugin marketplace it installs from (Issue #1145)', () => {
  assert.doesNotMatch(README, /No marketplace, no extensions/);
  assert.match(README, /\/plugin install weave --marketplace grunion-ai\/weave/);
});

test('the README What\'s inside table keeps every area row', () => {
  for (const area of ['Data model', 'Statistics', 'Views', 'Documents', 'Automations', 'Search', 'Storage', 'Forms', 'Sharing', 'Templates', 'Phone', 'Distribution', 'History', 'Interfaces']) {
    assert.match(section("What's inside"), new RegExp(`\\| ${area} \\|`), area);
  }
});

test('the README names the published container image (Issue #1146)', () => {
  assert.match(README, /docker run[^\n]*ghcr\.io\/grunion-ai\/weave/);
});

test('the Pages site carries a short title, a preview image and no empty handle (Issue #1148)', () => {
  const title = CONFIG.match(/^title:\s*(.+)$/m)?.[1].trim();
  assert.ok(title && title.length <= 60, `title is ${title?.length} characters`);
  assert.match(title, /weave/);
  const tagline = CONFIG.match(/^tagline:\s*(.+)$/m)?.[1].trim();
  assert.ok(tagline && tagline.length <= 70, `tagline is ${tagline?.length} characters`);
  const image = CONFIG.match(/^image:\s*(\S+)$/m)?.[1];
  assert.ok(image, 'docs/_config.yml names an image');
  assert.ok(existsSync(join(ROOT, 'docs', image.replace(/^\//, ''))), `docs/${image} exists`);
  assert.doesNotMatch(CONFIG, /^twitter:/m);
});
