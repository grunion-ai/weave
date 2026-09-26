/* The entity page shows its record's name once (F6, 2026-09-26 design pass).

   A document that opens with an H1 repeating the record name used to render
   that heading at 26px straight under the 20px page title, so the document
   out-shouted the page. The page now hides that first H1 and the markdown
   keeps it. The match rule is pure and lives in public/editor-lib.js; the
   one-visible-title check runs in test/entity-hierarchy-browser.test.mjs. */
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

test('a heading that repeats the name is an echo, trimmed and case-folded', () => {
  assert.equal(LIB.isTitleEcho('Design onboarding wizard', 'Design onboarding wizard'), true);
  assert.equal(LIB.isTitleEcho('  design ONBOARDING wizard ', 'Design onboarding wizard'), true);
  assert.equal(LIB.isTitleEcho('Design onboarding  wizard', 'Design onboarding wizard'), true, 'a non-breaking or doubled space is still one space');
});

test('a heading that says something else is not an echo', () => {
  assert.equal(LIB.isTitleEcho('Design onboarding wizard v2', 'Design onboarding wizard'), false);
  assert.equal(LIB.isTitleEcho('Requirements', 'Design onboarding wizard'), false);
  assert.equal(LIB.isTitleEcho('Design', 'Design onboarding wizard'), false, 'a prefix is not the name');
});

test('an unnamed record echoes nothing', () => {
  assert.equal(LIB.isTitleEcho('', ''), false);
  assert.equal(LIB.isTitleEcho('   ', null), false);
  assert.equal(LIB.isTitleEcho('Untitled', undefined), false);
});

test('the page applies the rule to the first block only, as a class Lute ignores', () => {
  assert.match(APP, /isTitleEcho\(headText\(/, 'the fold pass asks the rule about the first heading');
  assert.match(CSS, /\.vditor-reset > h1\.wv-title-echo\s*\{[^}]*display:\s*none/, 'the echo is hidden, not deleted');
});
