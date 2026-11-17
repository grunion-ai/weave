import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HTML_VIEW_POLICY, HTML_PAGE_POLICY } from '../../src/engine.js';

const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
const frameSandbox = app.match(/const HTML_FRAME_SANDBOX = '([^']*)'/)?.[1];

test('the three sandbox policies for uploaded HTML are pinned token for token (Issue #1433)', () => {
  assert.equal(HTML_VIEW_POLICY, "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:");
  assert.equal(HTML_PAGE_POLICY, "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; frame-src 'self'");
  assert.equal(frameSandbox, 'allow-scripts allow-popups');
});

test('no sandbox for uploaded HTML lets a popup leave it or shares the workspace origin (Issue #1433)', () => {
  for (const [name, policy] of [['HTML_VIEW_POLICY', HTML_VIEW_POLICY], ['HTML_PAGE_POLICY', HTML_PAGE_POLICY], ['HTML_FRAME_SANDBOX', frameSandbox]]) {
    assert.doesNotMatch(policy, /allow-popups-to-escape-sandbox/, `${name} keeps popups inside the sandbox`);
    assert.doesNotMatch(policy, /allow-same-origin/, `${name} never shares the workspace origin`);
    assert.match(policy, /allow-scripts/, `${name} still runs the page's own script`);
  }
});

test('the frame sandbox has one definition in the app and the editor reuses it (Issue #1433)', () => {
  assert.equal(app.match(/allow-popups/g).length, 1, 'one sandbox string in app.js');
  const editor = readFileSync(new URL('../../public/doc-editor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(editor, /allow-/, 'doc-editor.js spells no sandbox token of its own');
  assert.match(editor, /setAttribute\('sandbox', HTML_FRAME_SANDBOX\)/);
});
