/* Document outline dash rail (Issue #87).

   Vditor's own outline panel stays disabled — it wants the left gutter and a
   tree; weave's outline is a minimap: one dash per heading, longer for higher
   levels, a tracker that follows the scroll, click to jump. Only the entity
   page's document panels carry it, and only when a document has at least 3
   headings — below that a map explains nothing.

   The pure parts (dash spec, current-section pick) live in
   public/editor-lib.js and are tested here; geometry and scroll behavior are
   covered by the browser suite in test/editor-phase4-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

/* ---------- railSpec: one dash per heading, length by level ---------- */

const H = (...levels) => levels.map((level, i) => ({ level, text: `h${i}` }));

test('fewer than 3 headings means no rail at all', () => {
  assert.deepEqual(LIB.railSpec([]), []);
  assert.deepEqual(LIB.railSpec(H(1)), []);
  assert.deepEqual(LIB.railSpec(H(1, 2)), []);
});

test('3+ headings map to dashes whose length falls with depth', () => {
  const spec = LIB.railSpec(H(1, 2, 3, 6));
  assert.equal(spec.length, 4);
  assert.ok(spec[0].width > spec[1].width, 'h1 dash outreaches h2');
  assert.ok(spec[1].width > spec[2].width, 'h2 dash outreaches h3');
  assert.ok(spec[3].width >= 4, 'even h6 keeps a clickable dash');
  assert.equal(spec[0].text, 'h0', 'the dash carries its heading text for the tooltip');
});

test('equal levels get equal dashes', () => {
  const spec = LIB.railSpec(H(2, 2, 2));
  assert.ok(spec.every((d) => d.width === spec[0].width));
});

/* ---------- currentSection: the tracker ---------- */

test('the tracker picks the last heading above the reading line', () => {
  // tops are viewport-relative; the reading line sits below the site header.
  assert.equal(LIB.currentSection([100, 400, 900], 80), 0, 'nothing scrolled: first section');
  assert.equal(LIB.currentSection([-200, 40, 900], 80), 1, 'second heading passed the line');
  assert.equal(LIB.currentSection([-900, -400, -100], 80), 2, 'past the end: last section');
  assert.equal(LIB.currentSection([], 80), -1, 'no headings, no section');
});

/* ---------- wiring contracts ---------- */

test("Vditor's own outline stays disabled", () => {
  assert.match(APP, /outline:\s*\{\s*enable:\s*false/);
});

test('the rail exists only on entity-page document panels', () => {
  const calls = APP.match(/attachDashRail\(/g) ?? [];
  assert.equal(calls.length, 2, 'one definition, one call site (the entity page)');
  const docsEditor = APP.match(/function docsEditor\([^]{0,2500}?\n\}/)[0];
  assert.ok(!docsEditor.includes('attachDashRail'), 'inline row editors carry no rail');
});

test('the rail lives in the left gutter and hides on narrow screens', () => {
  assert.match(CSS, /\.doc-rail\s*\{[^}]*position:\s*absolute/);
  assert.match(CSS, /@media[^{]*max-width[^{]*\{[^]*?\.doc-rail\s*\{\s*display:\s*none/,
    'no gutter on narrow screens, no rail');
});

test('clicking a dash scrolls to its section', () => {
  assert.match(APP, /doc-rail-dash[^]{0,400}scrollIntoView/);
});
