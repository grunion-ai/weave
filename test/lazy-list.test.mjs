import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP, HTML, LAZY, ROUTED, ROOT, read } from './lib/source.mjs';

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

const outsideTemplates = HTML.replace(/<template[^]*?<\/template>/g, '');
const eagerScripts = [...outsideTemplates.matchAll(/<script src="\/([^"?]+\.js)"/g)].map((m) => `public/${m[1]}`).filter((f) => !f.startsWith('public/vendor/'));
const exposed = (src) => [...new Set([
  ...[...src.matchAll(/\b(?:root|window|globalThis|self)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]),
  ...[...src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
])];
const sources = Object.fromEntries(readdirSync(join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => [`public/${f}`, read(`public/${f}`)]));
const readersOf = (name, self) => Object.keys(sources).filter((f) => f !== self && new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])|\\.${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(sources[f]));

function lazyOnlyEager({ eager = eagerScripts, lazy = [...LAZY, ...ROUTED], readers = (name, self) => readersOf(name, self), globals = (f) => exposed(sources[f]) } = {}) {
  const late = new Set(lazy);
  const found = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const file of eager) {
      if (late.has(file)) continue;
      const names = globals(file);
      const who = names.flatMap((n) => readers(n, file));
      if (names.length && who.length && who.every((f) => late.has(f))) { late.add(file); found.push(file); grew = true; }
    }
  }
  return found.sort();
}

test('the transitive check flags an eager core whose only readers are lazy, directly or through another such core (Issue #1704)', () => {
  const readers = { A: ['lazy.js'], B: ['eager-a.js'], C: ['app.js'] };
  const globals = { 'eager-a.js': ['A'], 'eager-b.js': ['B'], 'eager-c.js': ['C'] };
  assert.deepEqual(lazyOnlyEager({ eager: Object.keys(globals), lazy: ['lazy.js'], readers: (n) => readers[n], globals: (f) => globals[f] }), ['eager-a.js', 'eager-b.js']);
});

test('no eager script exposes globals that only lazy files read, so boot never downloads a core nothing at boot uses (Issue #1704)', () => {
  assert.ok(eagerScripts.length > 30, `index.html lists the eager cores: ${eagerScripts.length}`);
  assert.deepEqual(lazyOnlyEager(), []);
});
