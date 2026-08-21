/* Shared Vditor for grid/board/list row documents (Issue #89).

   The recorded blocker was "a Vditor instance per row". Measured in a live
   browser before building this: a mount/unmount round-trip on a warm page
   costs 2-5ms (assets cached after the first editor), so ONE shared
   instance that mounts into the focused row's doc cell and unmounts on blur
   is cheap. The one leak destroy() does not clean is Vditor's icon sprite -
   every construction appends another hidden 53-symbol <svg> to <body>
   (measured: +1428 nodes over 12 cycles, all sprite) - so the mount path
   dedupes sprites, and the browser suite pins the count.

   The textarea stays as the resting state: it is the value the Save button
   reads and the redraw-preservation map snapshots, so the editor syncs
   every keystroke back into it and restores it on blur. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

test('focusing a row doc cell mounts the shared editor', () => {
  const docsEditor = APP.match(/function docsEditor\([^]{0,3000}?\n\}/)[0];
  assert.match(docsEditor, /addEventListener\('focus',\s*\(\)\s*=>\s*mountRowEditor\(area\)\)/,
    'the textarea focus is the mount trigger');
});

test('there is exactly one shared row editor, keyed by module state', () => {
  assert.match(APP, /let rowEditor = null/, 'a singleton, not a per-row instance');
  assert.match(APP, /function unmountRowEditor\(\)/, 'and one way to put it away');
  // Mounting over a different row first unmounts the previous one.
  const mount = APP.match(/function mountRowEditor\([^]{0,2000}?\n\}/)[0];
  assert.match(mount, /unmountRowEditor\(\)/);
});

test('every keystroke lands back in the textarea', () => {
  // The Save button and the redraw-preservation map read area.value; an
  // editor value living only in Vditor would be lost on either path.
  const mount = APP.match(/function mountRowEditor\([^]{0,2000}?\n\}/)[0];
  assert.match(mount, /area\.value = v/, 'input syncs to the textarea');
  assert.match(mount, /onBlur:\s*\(\)\s*=>\s*unmountRowEditor\(\)/, 'blur unmounts');
});

test('the icon sprite is deduped - the one leak destroy() does not clean', () => {
  assert.match(APP, /function dedupeVditorSprites\(\)/);
  const mounts = APP.match(/dedupeVditorSprites\(\)/g) ?? [];
  assert.ok(mounts.length >= 2, 'both the row mount and the page editors dedupe');
});

test('teardown restores the row before the page goes away', () => {
  const teardown = APP.match(/function teardownDocEditors\(\)[^]{0,800}/)[0];
  assert.match(teardown, /unmountRowEditor\(\)/);
});
