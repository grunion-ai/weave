import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
const CSS_TOOLBAR = CSS.match(/\.doc-editor \.vditor-toolbar\s*\{[^}]*\}/)?.[0] ?? '';
const VENDOR = 'public/vendor/vditor';

let base, server;
test.before(async () => {
  ({ server } = await startServer(new Weave(), { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('the vendored tree carries every asset the editor loads at runtime', () => {
  for (const rel of [
    'dist/index.min.js',
    'dist/index.css',
    'dist/js/lute/lute.min.js',
    'dist/js/i18n/en_US.js',
    'dist/js/icons/ant.js',
    'dist/js/highlight.js/highlight.min.js',
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

test('mermaid is vendored once, not twice', () => {
  assert.ok(!existsSync(join(ROOT, VENDOR, 'dist/js/mermaid/mermaid.min.js')),
    'a second mermaid build must not be vendored under vditor/');
  assert.ok(existsSync(join(ROOT, 'public/vendor/mermaid.min.js')),
    'the single mermaid copy must still be there');
});

test('the editor is pointed at the vendored copy, never a public CDN', () => {
  assert.match(APP, /cdn:\s*['"]\/vendor\/vditor['"]/,
    'app.js must set cdn to the vendored path');
  for (const host of ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']) {
    assert.doesNotMatch(APP, new RegExp(host.replace('.', '\\.')),
      `app.js must not reference ${host}`);
  }
});

test('the editor is instant-rendering, never split view or mode-switched', () => {
  assert.match(APP, /mode:\s*['"]ir['"]/, "Vditor must run in 'ir' (Typora-style) mode");
  assert.doesNotMatch(APP, /mode:\s*['"]sv['"]/, 'split view is the model Kyle ruled out');
  assert.doesNotMatch(APP, /mode:\s*['"]wysiwyg['"]/, 'wysiwyg mode hides the markdown');
});

test('there is no edit mode, no preview toggle and no save button', () => {
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

test('the toolbar carries the full set Kyle picked in the Toolbar Lab', () => {
  const from = APP.indexOf('toolbar: [');
  const conf = APP.slice(from, APP.indexOf('toolbarConfig', from) + 80);
  for (const item of ['headings', 'bold', 'italic', 'strike', 'inline-code', 'link',
    'list', 'ordered-list', 'check', 'outdent', 'indent',
    'quote', 'code', 'table', 'line', 'undo', 'redo', 'upload']) {
    assert.ok(conf.includes(`'${item}'`), `toolbar is missing: ${item}`);
  }
  assert.match(conf, /toolbarConfig:\s*\{\s*hide:\s*false/,
    'Vditor never hides the bar itself — visibility belongs to the bubble layer');
});

test('the toolbar draws the Toolbar Lab icon set, not the sprite icons', () => {
  const from = APP.indexOf('const WV_TB_ICONS');
  assert.ok(from > 0, 'the approved icon map exists');
  const map = APP.slice(from, APP.indexOf('};', from));
  for (const item of ['headings', 'bold', 'italic', 'strike', 'inline-code', 'link',
    'list', 'ordered-list', 'check', 'outdent', 'indent',
    'quote', 'code', 'table', 'line', 'undo', 'redo', 'upload']) {
    assert.ok(new RegExp(`'?${item}'?:`).test(map), `no lab icon for: ${item}`);
  }
  assert.match(APP, /icon:\s*WV_TB_ICONS\[n\]/, 'every toolbar item takes its lab icon');
});

test('the toolbar is a selection bubble, not a fixed strip', () => {
  assert.match(APP, /attachToolbarBubble/, 'a bubble layer positions the bar');
  assert.match(CSS_TOOLBAR, /position:\s*absolute/, 'the bar leaves the flow');
  assert.match(APP, /upload:\s*\{/, 'uploads route through a custom handler');
  assert.match(APP, /contentBase64/, 'files land on the entity via the files API');
  assert.ok(CSS_TOOLBAR, 'the toolbar has its own rule block in style.css');
});

test('markdown formatting is reachable from a slash menu', () => {
  assert.match(APP, /key:\s*['"]\/['"]/, "hint.extend must register the '/' trigger");
  assert.match(APP, /slashItems/, 'the menu contents must come from one list');
});

test('the slash menu covers the markdown-native block set', () => {
  const from = APP.indexOf('function slashItems');
  const list = APP.slice(from, APP.indexOf('\n}\n', from));
  for (const needle of ['Text', 'Heading 1–6', 'Bold', 'Italic', 'Inline code', 'Code block',
    'Quote', 'Table', 'Bulleted', 'Numbered', 'Task', 'Divider', 'Image', 'Raw HTML',
    'Link', 'Mermaid', 'Entity', 'Space / workspace']) {
    assert.ok(list.includes(needle), `slash menu is missing: ${needle}`);
  }
  const rows = [...list.matchAll(/\{ label: '[^']+',[^}]*\}/g)].map((m) => m[0]);
  assert.ok(rows.length >= 20, `expected the full catalogue, found ${rows.length} rows`);
  for (const row of rows) {
    assert.match(row, /icon: '/, `no glyph: ${row.slice(0, 44)}`);
    assert.match(row, /hint: '/, `no syntax hint: ${row.slice(0, 44)}`);
  }
  const titled = new Set([...APP.matchAll(/\['(\w+)', '[^']+'\],/g)].map((m) => m[1]));
  for (const m of list.matchAll(/group: '(\w+)'/g)) {
    assert.ok(titled.has(m[1]), `group '${m[1]}' has no title in SLASH_GROUPS`);
  }
});

test('the vendored hint renders the whole catalogue, not the first eight rows', () => {
  const vendor = readFileSync(join(ROOT, 'public/vendor/vditor/dist/index.min.js'), 'utf8');
  assert.ok(vendor.includes('if(!(n>63))'), 'the hint row cap must be patched up from 8 to 64');
  assert.ok(!vendor.includes('if(!(n>7))'), 'and the stock cap must be gone');
});

test('the theme is applied before the first render', () => {
  const boot = APP.indexOf('withPageLoader(() => loadSchema()');
  const theme = APP.indexOf('wireThemeToggle();');
  assert.ok(theme > 0 && boot > 0, 'boot sequence not found');
  assert.ok(theme < boot, 'wireThemeToggle() must run before the first render');
});

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
  const alias = await fetch(`${base}/vendor/vditor/dist/js/mermaid/mermaid.min.js`);
  assert.equal(alias.status, 200, 'the alias must resolve');
  const canonical = await fetch(`${base}/vendor/mermaid.min.js`);
  assert.equal(alias.headers.get('content-length'), canonical.headers.get('content-length'),
    'the alias must serve the same bytes as the canonical copy');
});
