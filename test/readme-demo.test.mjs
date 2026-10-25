import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const GIF = join(ROOT, 'docs', 'demo.gif');
const POSTER = join(ROOT, 'docs', 'demo-poster.png');
const RECORDER = join(ROOT, 'scripts', 'record-demo.mjs');
const LIMIT = 3 * 1024 * 1024;

const heroTag = () => README.match(/<img[^>]*src="docs\/demo\.gif"[^>]*>/)?.[0];

test('the README shows docs/demo.gif under the lead paragraph and above the table screenshot', () => {
  const tag = heroTag();
  assert.ok(tag, 'README has an <img src="docs/demo.gif">');
  const at = README.indexOf(tag);
  assert.ok(at > README.indexOf('One SQLite file. Zero dependencies.'), 'the clip sits under the lead paragraph');
  assert.ok(at < README.indexOf('docs/screenshots/table.png'), 'the clip sits above the table screenshot');
});

test('the hero clip carries plain alt text that says what happens', () => {
  const alt = heroTag()?.match(/alt="([^"]+)"/)?.[1] ?? '';
  for (const word of ['build', 'table', 'document', 'MCP']) assert.match(alt, new RegExp(word, 'i'), alt);
  assert.doesNotMatch(alt, /—/, 'no em dash in the alt text');
});

test('docs/demo.gif is an animated GIF under 3 MB', () => {
  assert.ok(existsSync(GIF), 'docs/demo.gif exists');
  const size = statSync(GIF).size;
  assert.ok(size > 0 && size < LIMIT, `docs/demo.gif weighs ${size} bytes`);
  const bytes = readFileSync(GIF);
  assert.equal(bytes.subarray(0, 6).toString('latin1'), 'GIF89a');
  assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')), 'the GIF loops');
});

test('docs/demo-poster.png is a PNG still', () => {
  assert.ok(existsSync(POSTER), 'docs/demo-poster.png exists');
  assert.deepEqual([...readFileSync(POSTER).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('scripts/record-demo.mjs reproduces both files from a scratch workspace', () => {
  assert.ok(existsSync(RECORDER), 'scripts/record-demo.mjs exists');
  const src = readFileSync(RECORDER, 'utf8');
  for (const needle of ['demo.gif', 'demo-poster.png', 'palettegen', '"build"', '"serve"', '"mcp"', 'mkdtemp']) {
    assert.ok(src.includes(needle), `recorder mentions ${needle}`);
  }
  assert.doesNotMatch(src, /4400/, 'the recorder never touches the :4400 instance');
});
