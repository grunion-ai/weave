import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.mjs';
import { PUBLIC_GLOBALS, sharedGlobal } from '../src/public-globals.js';
import '../public/board-core.js';

const SRC = join(ROOT, 'src');
const FILES = readdirSync(SRC).filter((n) => n.endsWith('.js'));
const sourceOf = (name) => readFileSync(join(SRC, name), 'utf8');

const STATIC_IMPORT = /^import '\.\.\/public\/[\w./-]+\.js';$/;
const PUBLIC_JS_REF = /\.\.\/public\/[\w./${}-]*\.js/;
const BROWSER_TEMPLATE_READS = ['applet.js:chipCore', 'applet.js:bugCore'];
const READS_IN_BROWSER_TEMPLATE = 'the read sits in an applet template and runs in the browser, where the classic script has already set the global';

test('sharedGlobal hands back the module once its public file is imported', () => {
  assert.equal(typeof sharedGlobal('weaveBoardCore').laneGrid, 'function');
});

test('sharedGlobal names the public file to import when the global is missing', () => {
  const had = globalThis.weaveBoardCore;
  delete globalThis.weaveBoardCore;
  try {
    assert.throws(() => sharedGlobal('weaveBoardCore'), /public\/board-core\.js/);
  } finally {
    globalThis.weaveBoardCore = had;
  }
});

test('sharedGlobal refuses a name no public file owns', () => {
  assert.throws(() => sharedGlobal('weaveNowhere'), /src\/public-globals\.js/);
});

test('every shared global is defined by the public file PUBLIC_GLOBALS names', () => {
  const missing = [];
  for (const [name, owner] of Object.entries(PUBLIC_GLOBALS)) {
    const src = readFileSync(join(ROOT, 'public', owner), 'utf8');
    if (!new RegExp(`(root|globalThis)\\.${name}\\b`).test(src)) missing.push(`public/${owner} does not define ${name}`);
  }
  assert.deepEqual(missing, []);
});

test('src loads a public module only through a static import, never inside a try', () => {
  const bad = [];
  for (const file of FILES) {
    for (const line of sourceOf(file).split('\n')) {
      if (!PUBLIC_JS_REF.test(line)) continue;
      if (STATIC_IMPORT.test(line.trim())) continue;
      bad.push(`src/${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], 'a dynamic import of public/ hides the dependency from a grep and a catch can swallow it');
});

test('a module that reads a shared global imports the public file that defines it', () => {
  const bad = [];
  for (const file of FILES) {
    const src = sourceOf(file);
    for (const [, name] of src.matchAll(/sharedGlobal\('([^']+)'\)/g)) {
      const owner = PUBLIC_GLOBALS[name];
      if (!owner) { bad.push(`src/${file} reads ${name}, which src/public-globals.js does not own`); continue; }
      if (!src.includes(`import '../public/${owner}';`)) bad.push(`src/${file} reads ${name} without import '../public/${owner}'`);
    }
  }
  assert.deepEqual(bad, []);
});

test('src reads a shared public global only through sharedGlobal', () => {
  const bad = [];
  for (const file of FILES) {
    if (file === 'public-globals.js') continue;
    const src = sourceOf(file);
    for (const name of Object.keys(PUBLIC_GLOBALS)) {
      if (!new RegExp(`globalThis\\.${name}\\b`).test(src)) continue;
      if (BROWSER_TEMPLATE_READS.includes(`${file}:${name}`)) continue;
      bad.push(`src/${file} reads globalThis.${name}`);
    }
  }
  assert.deepEqual(bad, [], `a bare globalThis read leaves undefined where a missing module should throw, unless ${READS_IN_BROWSER_TEMPLATE}`);
});

test('PUBLIC_GLOBALS carries only names a src module reads', () => {
  const read = new Set();
  for (const file of FILES) {
    for (const [, name] of sourceOf(file).matchAll(/sharedGlobal\('([^']+)'\)/g)) read.add(name);
  }
  assert.deepEqual(Object.keys(PUBLIC_GLOBALS).filter((n) => !read.has(n)), []);
});
