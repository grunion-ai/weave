/* Feature #183, deliverable 1: the relation-map mockup page for polymorphic
   junctions. The page is a design artefact, not shipped UI, so the contract
   is small: it exists, it is self-contained (no network), it shows the four
   options Kyle picks from in both themes, and it is drawn on the real
   Showcase schema — the five target-set fields by name. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'docs/mockups/relation-map-polymorphic.html');
const html = existsSync(PATH) ? readFileSync(PATH, 'utf8') : '';

test('the mockup page exists', () => {
  assert.ok(existsSync(PATH), `${PATH} missing`);
  assert.ok(html.length > 5000, 'page is suspiciously small');
});

test('no external resources: every asset is inline', () => {
  // src=, href= and CSS url()/@import must never reach the network.
  const external = html.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*/gi) ?? [];
  assert.deepEqual(external, [], 'external src/href found');
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i, 'external CSS url()');
  assert.doesNotMatch(html, /@import/i, '@import found');
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet/i, 'external stylesheet link');
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|new WebSocket/, 'runtime network call');
});

test('names all four layout options, each with what it communicates and what it costs', () => {
  for (const opt of ['A. Junction node', 'B. Bundled edges', 'C. Concentric', 'D. Matrix companion']) {
    assert.ok(html.includes(opt), `missing option "${opt}"`);
  }
  // One caption line per option: "Communicates … Costs …".
  const captions = html.match(/class="caption"/g) ?? [];
  assert.equal(captions.length, 4, 'expected one caption per option');
  assert.equal((html.match(/<b>Communicates\.<\/b>/g) ?? []).length, 4);
  assert.equal((html.match(/<b>Costs\.<\/b>/g) ?? []).length, 4);
});

test('both themes side by side for every option', () => {
  assert.equal((html.match(/<div class="pane" data-bs-theme="light">/g) ?? []).length, 4);
  assert.equal((html.match(/<div class="pane" data-bs-theme="dark">/g) ?? []).length, 4);
});

test('drawn on the real Showcase schema: the five target-set fields and the plain pairs', () => {
  for (const field of ['Related', 'On', 'Of', 'Applied to', 'Subject']) {
    assert.match(html, new RegExp(`name:\\s*'${field}'[^}]*poly:\\s*true`), `target-set field ${field} not in the embedded schema`);
  }
  for (const table of ['Notes', 'Comments', 'Approvals', 'Tags', 'Activity', 'Projects', 'Tasks', 'Expenses', 'Line Items', 'Workspace']) {
    assert.ok(html.includes(`'${table}'`), `table ${table} missing`);
  }
});

test('plain vs polymorphic are styled apart and one set lights at a time', () => {
  assert.match(html, /\.rel-line\.poly/, 'no distinct polymorphic stroke style');
  assert.match(html, /'data-set'|data-set=/, 'no set membership on the drawn elements');
  assert.match(html, /\.dim\b/, 'no dimmed state for the sets not in focus');
  assert.match(html, /mouseenter|mouseover|pointerenter/, 'no hover handler');
});

test('the inline script parses', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, 'no inline script');
  for (const src of scripts) assert.doesNotThrow(() => new Function(src));
});
