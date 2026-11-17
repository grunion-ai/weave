import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import { Weave } from '../src/engine.js';
import { ROOT, HTML } from './lib/source.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const SAMPLES = ['', 'a', 'FIRST_TEXT', 'é à ü', '日本語のテキスト', '🧵 weave 🪡', '👩‍💻 \u0000 ￿', '\n\n- [ ] task\n', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'ü'.repeat(60), 'line\n'.repeat(4000), '🧵'.repeat(20000)];

function loaded() {
  const sandbox = { TextEncoder };
  vm.runInNewContext(readFileSync(join(ROOT, 'public/doc-base.js'), 'utf8'), sandbox);
  return sandbox;
}

test('the document base hashes text exactly as node:crypto does, with no crypto in reach (Issue #1682)', () => {
  const sandbox = loaded();
  assert.equal(typeof sandbox.crypto, 'undefined');
  for (const text of SAMPLES) assert.equal(sandbox.weaveDocBase(text), hash(text), `${JSON.stringify(text.slice(0, 20))} (${text.length} chars)`);
});

test('the document base matches the base the engine checks a save against (Issue #1682)', () => {
  const { weaveDocBase } = loaded();
  const w = new Weave({ actor: 'web' });
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  const task = w.createEntity('Product/Task', { Name: 'Ship' });
  for (const text of SAMPLES) {
    if (text) w.setDoc(task.id, text);
    assert.equal(weaveDocBase(text), w.docBase(task.id), `${JSON.stringify(text.slice(0, 20))} (${text.length} chars)`);
  }
});

test('the app loads the document base before app.js, which falls back to it', () => {
  assert.match(HTML, /<script src="\/doc-base\.js" defer><\/script>/);
  assert.ok(HTML.indexOf('/doc-base.js') < HTML.indexOf('/app.js'));
});

test('SHA-256 is written once, in public/doc-base.js', () => {
  const marker = 'primes.every((p) => n % p)';
  const holders = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== 'vendor') walk(full); }
      else if (/\.m?js$/.test(d.name) && readFileSync(full, 'utf8').includes(marker)) holders.push(relative(ROOT, full));
    }
  };
  for (const dir of ['public', 'src', 'bin']) walk(join(ROOT, dir));
  assert.deepEqual(holders, ['public/doc-base.js']);
});
