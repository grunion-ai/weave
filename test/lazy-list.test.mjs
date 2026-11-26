import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, HTML, LAZY, ROUTED, read } from './lib/source.mjs';

const templated = [...(/<template id="lazy-assets">([^]*?)<\/template>/.exec(HTML)?.[1] ?? '').matchAll(/<script src="\/([^"?]+)"><\/script>/g)]
  .map((m) => `public/${m[1]}`).sort();

test('the lazy lists name every file the shell loads on demand, so no lazy file escapes the cold-load watch or the source readers (Issue #1706)', () => {
  assert.ok(templated.length >= 17, `the lazy-assets template lists the lazy files: ${templated.join(' ')}`);
  assert.deepEqual([...LAZY, ...ROUTED].sort(), templated);
  for (const file of ['public/settings-view.js', 'public/board-view.js', 'public/invite-dialog.js', 'public/space-launcher-view.js', 'public/workflows-cells.js', 'public/starter-gallery.js']) {
    assert.ok(LAZY.includes(file), `${file} is watched by the cold-load gate`);
  }
});

test('a file is cold-load watched or routed, never both, and routed only when a lazyScript call loads it (Issue #1706)', () => {
  assert.deepEqual(LAZY.filter((file) => ROUTED.includes(file)), []);
  assert.equal(new Set(LAZY).size, LAZY.length);
  for (const file of ROUTED) assert.match(APP, new RegExp(`lazyScript\\('/${file.slice('public/'.length).replace('.', '\\.')}'\\)`), `${file} is loaded by a lazyScript call`);
});

test('source readers see every lazy file (Issue #1706)', () => {
  for (const file of [...LAZY, ...ROUTED]) assert.ok(APP.includes(read(file)), `${file} is part of APP`);
});
