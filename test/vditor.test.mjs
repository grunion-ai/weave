/* The embedded markdown editor (Feature #45).

   Vditor is vendored pinned under public/vendor/vditor, per the house rule
   that third-party code is never npm-installed at runtime. Vditor lazy-loads
   its own sub-resources from `${cdn}/dist/js/...` at runtime, which makes two
   things testable and worth pinning: that the tree we vendored actually
   contains every path the editor will reach for, and that `cdn` points at our
   copy so a weave instance with no internet still renders documents.

   The editor contracts (always-rendered, no mode switch, no save button,
   formatting under a slash menu) are asserted at source level for the same
   reason as test/ui-contract.test.mjs — the UI is dependency-free vanilla JS
   with no DOM runtime available to node --test. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const VENDOR = 'public/vendor/vditor';
const PINNED = '3.11.3';

let base, server;
test.before(async () => {
  ({ server } = await startServer(new Weave(), { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/* ---------- the vendored tree ---------- */

test('the vendored tree carries every asset the editor loads at runtime', () => {
  // Each of these is a path Vditor's own code builds as `${cdn}/dist/...`.
  // A missing one fails silently in the browser as an unrendered document,
  // so the install gate is here rather than in a smoke test.
  for (const rel of [
    'dist/index.min.js',
    'dist/index.css',
    'dist/js/lute/lute.min.js',      // the markdown engine itself
    'dist/js/i18n/en_US.js',
    'dist/js/icons/ant.js',
    'dist/js/highlight.js/highlight.min.js',
    // Vditor requests this straight after highlight.min.js. Pruning it left a
    // 404 in every document that contains a code block.
    'dist/js/highlight.js/third-languages.js',
    'dist/js/highlight.js/styles/github.min.css',
    'dist/js/highlight.js/styles/github-dark.min.css',
    'dist/css/content-theme/light.css',
    'dist/css/content-theme/dark.css',
    'LICENSE',
  ]) {
    assert.ok(existsSync(join(ROOT, VENDOR, rel)), `missing vendored asset: ${rel}`);
  }
});

test('the vendored build is the pinned version', () => {
  const core = readFileSync(join(ROOT, VENDOR, 'dist/index.min.js'), 'utf8');
  assert.ok(core.includes(PINNED), `vendored index.min.js should carry ${PINNED}`);
});

test('mermaid is vendored once, not twice', () => {
  // Vditor ships its own 3.5MB mermaid. weave already vendors its own mermaid (≥ 11.9.0, Issue #8), so the
  // editor is pointed at that copy through a server alias instead.
  assert.ok(!existsSync(join(ROOT, VENDOR, 'dist/js/mermaid/mermaid.min.js')),
    'a second mermaid build must not be vendored under vditor/');
  assert.ok(existsSync(join(ROOT, 'public/vendor/mermaid.min.js')),
    'the single mermaid copy must still be there');
});

/* ---------- offline: nothing may reach a public CDN ---------- */

test('the editor is pointed at the vendored copy, never a public CDN', () => {
  // Vditor's `cdn` option defaults to https://unpkg.com/vditor@<version>.
  // Leaving the default would make documents depend on the public internet.
  assert.match(APP, /cdn:\s*['"]\/vendor\/vditor['"]/,
    'app.js must set cdn to the vendored path');
  for (const host of ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']) {
    assert.doesNotMatch(APP, new RegExp(host.replace('.', '\\.')),
      `app.js must not reference ${host}`);
  }
});

/* ---------- the always-rendered contract ---------- */

test('the editor is instant-rendering, never split view or mode-switched', () => {
  assert.match(APP, /mode:\s*['"]ir['"]/, "Vditor must run in 'ir' (Typora-style) mode");
  assert.doesNotMatch(APP, /mode:\s*['"]sv['"]/, 'split view is the model Kyle ruled out');
  assert.doesNotMatch(APP, /mode:\s*['"]wysiwyg['"]/, 'wysiwyg mode hides the markdown');
});

test('there is no edit mode, no preview toggle and no save button', () => {
  // The pre-Vditor entity page had an Edit/Preview toggle over an iframe and a
  // View/MD/MMD/PDF switcher. Rendering IS editing now, so the toggle is gone;
  // MD/MMD/PDF survive only as downloads.
  assert.doesNotMatch(APP, /doc-frame/, 'the preview iframe is gone');
  assert.doesNotMatch(APP, /'Preview'/, 'no Preview control');
  for (const label of ['Save', 'Saving']) {
    assert.doesNotMatch(APP, new RegExp(`>\\s*${label}\\s*<`), `no ${label} button`);
  }
});

test('every keystroke is persisted without the user asking', () => {
  assert.match(APP, /input:\s*\(/, 'Vditor input callback must be wired');
  assert.match(APP, /saveDoc|scheduleDocSave/, 'a save path must exist');
  assert.match(APP, /setTimeout\([^)]*DOC_SAVE_DEBOUNCE|DOC_SAVE_DEBOUNCE/,
    'saves must be debounced rather than fired per keystroke');
});

test('the toolbar is gone so the document is the only chrome', () => {
  assert.match(APP, /toolbar:\s*\[\]/, 'no toolbar items');
  assert.match(APP, /hide:\s*true/, 'and the toolbar bar itself is hidden');
});

/* ---------- slash menu ---------- */

test('markdown formatting is reachable from a slash menu', () => {
  assert.match(APP, /key:\s*['"]\/['"]/, "hint.extend must register the '/' trigger");
  assert.match(APP, /slashItems/, 'the menu contents must come from one list');
});

test('the slash menu covers the markdown-native block set', () => {
  // The toolbar is hidden, so anything absent here is unreachable.
  const list = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function slashItems') + 3000);
  for (const needle of ['Heading 1', 'Bold', 'Italic', 'Code', 'Quote', 'Table',
    'Bulleted', 'Numbered', 'Task', 'Divider', 'Link', 'Mermaid']) {
    assert.ok(list.includes(needle), `slash menu is missing: ${needle}`);
  }
});

test('the theme is applied before the first render', () => {
  /* Defect this guards: boot called wireThemeToggle() after the first route,
     so editors mounted with no data-bs-theme on <html>. The editor chrome
     caught up through setTheme, but a mermaid diagram renders its SVG once at
     mount — measured live on a dark page, node fill was rgb(236,236,255), the
     light palette, under a rgb(17,24,39) body. */
  const boot = APP.indexOf('withPageLoader(() => loadSchema()');
  const theme = APP.indexOf('wireThemeToggle();');
  assert.ok(theme > 0 && boot > 0, 'boot sequence not found');
  assert.ok(theme < boot, 'wireThemeToggle() must run before the first render');
});

/* ---------- served correctly ---------- */

test('the server serves the vendored editor with usable content types', async () => {
  const js = await fetch(`${base}/vendor/vditor/dist/index.min.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  const css = await fetch(`${base}/vendor/vditor/dist/index.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const lute = await fetch(`${base}/vendor/vditor/dist/js/lute/lute.min.js`);
  assert.equal(lute.status, 200, 'the markdown engine must be reachable');
});

test('the editor gets mermaid from the single vendored copy', async () => {
  // Vditor asks for mermaid under its own dist tree; the server aliases that
  // path onto the one build weave already ships.
  const alias = await fetch(`${base}/vendor/vditor/dist/js/mermaid/mermaid.min.js`);
  assert.equal(alias.status, 200, 'the alias must resolve');
  const canonical = await fetch(`${base}/vendor/mermaid.min.js`);
  assert.equal(alias.headers.get('content-length'), canonical.headers.get('content-length'),
    'the alias must serve the same bytes as the canonical copy');
});
